/**
 * Dynamic Multi-Tenant 3CX Connector Supervisor.
 *
 * Discovers and orchestrates per-tenant 3CX runtimes dynamically from active
 * tenant configurations stored in the database or credential broker.
 *
 * Automatically provisions new PBX connections as new accounts configure
 * their 3CX integrations, gracefully rotates credentials, and drains/terminates
 * removed or disabled tenants.
 */

export class MultiTenantSupervisor {
  constructor({
    fetchActiveTenants,
    createTenantRuntime,
    reconcileIntervalMs = 15000,
    failureBackoffMs = 300000,
    onSignal = () => {},
  }) {
    if (typeof fetchActiveTenants !== "function") {
      throw new TypeError("fetchActiveTenants must be an asynchronous function");
    }
    if (typeof createTenantRuntime !== "function") {
      throw new TypeError("createTenantRuntime must be a factory function");
    }
    if (typeof onSignal !== "function") {
      throw new TypeError("onSignal must be a function");
    }
    if (!Number.isInteger(reconcileIntervalMs) || reconcileIntervalMs < 1000 || reconcileIntervalMs > 300000) {
      throw new RangeError("reconcileIntervalMs must be between 1000 and 300000 ms");
    }

    this.fetchActiveTenants = fetchActiveTenants;
    this.createTenantRuntime = createTenantRuntime;
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.failureBackoffMs = failureBackoffMs;
    this.onSignal = onSignal;
    this.tenants = new Map(); // companyId -> { config, runtime, fingerprint, state }
    this.failedTenants = new Map(); // companyId -> { fingerprint, retryAfter }
    this.timer = null;
    this.state = "idle";
    this.reconciling = false;
  }

  get isRunning() {
    return this.state === "running";
  }

  get runningTenantCount() {
    return this.tenants.size;
  }

  getRunningTenants() {
    const list = [];
    for (const [companyId, entry] of this.tenants.entries()) {
      list.push({
        companyId,
        state: entry.state,
        routePointDn: entry.config?.routePointDn,
        dids: entry.config?.dids || [],
      });
    }
    return list;
  }

  async start() {
    if (this.state === "running") return { started: true, runningCount: this.tenants.size };
    if (this.state !== "idle") throw new Error("Supervisor cannot be restarted once stopped");

    this.state = "running";
    this.#signal("supervisor_started");
    await this.reconcile();
    this.#scheduleNextReconcile();
    return { started: true, runningCount: this.tenants.size };
  }

  async reconcile() {
    if (this.reconciling || this.state !== "running") return { skipped: true };
    this.reconciling = true;

    try {
      const activeList = await this.fetchActiveTenants();
      if (!Array.isArray(activeList)) {
        this.#signal("invalid_active_tenants_payload");
        return { error: "invalid_payload" };
      }

      const activeMap = new Map();
      for (const tenant of activeList) {
        if (tenant?.companyId) {
          activeMap.set(tenant.companyId, tenant);
        }
      }

      // 1. Remove tenants no longer active
      for (const [companyId, entry] of [...this.tenants.entries()]) {
        if (!activeMap.has(companyId)) {
          this.#signal("stopping_removed_tenant", { companyId });
          this.failedTenants.delete(companyId);
          await this.#stopTenant(companyId, entry);
        }
      }
      for (const companyId of [...this.failedTenants.keys()]) {
        if (!activeMap.has(companyId)) {
          this.failedTenants.delete(companyId);
        }
      }

      // 2. Add new tenants or update changed ones
      for (const [companyId, config] of activeMap.entries()) {
        const fingerprint = computeFingerprint(config);
        const existing = this.tenants.get(companyId);

        if (!existing) {
          const failed = this.failedTenants.get(companyId);
          if (failed && failed.fingerprint === fingerprint && Date.now() < failed.retryAfter) {
            continue;
          }
          await this.#startTenant(companyId, config, fingerprint);
        } else if (existing.fingerprint !== fingerprint) {
          this.#signal("restarting_updated_tenant", { companyId });
          this.failedTenants.delete(companyId);
          await this.#stopTenant(companyId, existing);
          await this.#startTenant(companyId, config, fingerprint);
        }
      }

      this.#signal("reconcile_completed", { activeCount: this.tenants.size });
      return { success: true, activeCount: this.tenants.size };
    } catch (err) {
      this.#signal("reconcile_error", { error: err.message });
      return { error: err.message };
    } finally {
      this.reconciling = false;
    }
  }

  async shutdown() {
    if (this.state === "stopped") return { stopped: true };
    this.state = "stopping";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const shutdownPromises = [];
    for (const [companyId, entry] of this.tenants.entries()) {
      shutdownPromises.push(this.#stopTenant(companyId, entry));
    }

    await Promise.allSettled(shutdownPromises);
    this.tenants.clear();
    this.failedTenants.clear();
    this.state = "stopped";
    this.#signal("supervisor_stopped");
    return { stopped: true };
  }

  async #startTenant(companyId, config, fingerprint) {
    let runtime;
    try {
      runtime = this.createTenantRuntime(config);
      const entry = {
        config,
        runtime,
        fingerprint,
        state: "starting",
      };
      this.tenants.set(companyId, entry);

      if (runtime && typeof runtime.start === "function") {
        await runtime.start();
      }
      entry.state = "running";
      this.failedTenants.delete(companyId);
      this.#signal("tenant_started", { companyId });
    } catch (err) {
      this.tenants.delete(companyId);
      if (this.failureBackoffMs > 0) {
        this.failedTenants.set(companyId, {
          fingerprint,
          retryAfter: Date.now() + this.failureBackoffMs,
        });
      }
      this.#signal("tenant_start_failed", { companyId, error: err.message });
    }
  }

  async #stopTenant(companyId, entry) {
    entry.state = "stopping";
    try {
      if (entry.runtime && typeof entry.runtime.shutdown === "function") {
        await entry.runtime.shutdown();
      }
    } catch (err) {
      this.#signal("tenant_stop_error", { companyId, error: err.message });
    } finally {
      this.tenants.delete(companyId);
      this.#signal("tenant_stopped", { companyId });
    }
  }

  #scheduleNextReconcile() {
    if (this.state !== "running") return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.state === "running") {
        await this.reconcile();
        this.#scheduleNextReconcile();
      }
    }, this.reconcileIntervalMs);
    this.timer.unref?.();
  }

  #signal(name, data = {}) {
    try {
      this.onSignal({ event: name, ...data });
    } catch { /* Metrics/logging should never break supervisor */ }
  }
}

function computeFingerprint(config) {
  const parts = [
    config.companyId,
    config.routePointDn,
    config.pbxHostname || config.pbxUrl,
    config.appId,
    (config.dids || []).slice().sort().join(","),
    config.failureAction,
    config.failureDestination,
    config.credentialUpdatedAt || "",
  ];
  return parts.join("|");
}

