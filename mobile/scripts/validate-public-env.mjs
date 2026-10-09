import fs from 'node:fs';

// Safely load local .env file if it exists and variables are not already set
if (fs.existsSync('.env')) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile('.env');
    } else {
      const content = fs.readFileSync('.env', 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Non-fatal if loading local .env fails
  }
}

const required = ['EXPO_PUBLIC_APP_URL', 'EXPO_PUBLIC_BACKEND_URL'];
const forbidden = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i;
const secretName = /(SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY|API_KEY)/i;
const allowInsecure = process.env.ALLOW_INSECURE_LOCAL_URLS === '1';

const errors = [];
for (const name of required) {
  const value = process.env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required for a packaged build.`);
    continue;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${name} must be an absolute URL.`);
    continue;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    errors.push(`${name} must use http or https.`);
  }
  if (!allowInsecure && parsed.protocol !== 'https:') {
    errors.push(`${name} must use HTTPS for a release build.`);
  }
  if (!allowInsecure && forbidden.test(parsed.hostname)) {
    errors.push(`${name} cannot point to localhost or loopback in a release build.`);
  }
  if (parsed.username || parsed.password) {
    errors.push(`${name} must not contain URL credentials.`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    errors.push(`${name} must be an origin without a path, query, or hash.`);
  }
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('EXPO_PUBLIC_') && secretName.test(name)) {
    errors.push(`${name} looks like a secret and must not be embedded in the APK.`);
  }
  if (name === 'EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT' && value) {
    try {
      const endpoint = new URL(value);
      if (!allowInsecure && endpoint.protocol !== 'https:') {
        errors.push('EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT must use HTTPS for a release build.');
      }
      if (endpoint.username || endpoint.password) {
        errors.push('EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT must not contain URL credentials.');
      }
      if (!allowInsecure && forbidden.test(endpoint.hostname)) {
        errors.push('EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT cannot point to localhost or loopback in a release build.');
      }
    } catch {
      errors.push('EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT must be an absolute URL.');
    }
  }
  if (name === 'EXPO_PUBLIC_LIVEKIT_URL' && value) {
    try {
      const livekit = new URL(value);
      if (livekit.protocol !== 'wss:') {
        errors.push('EXPO_PUBLIC_LIVEKIT_URL must use wss://.');
      }
      if (livekit.username || livekit.password) {
        errors.push('EXPO_PUBLIC_LIVEKIT_URL must not contain URL credentials.');
      }
      if (livekit.pathname !== '/' || livekit.search || livekit.hash) {
        errors.push('EXPO_PUBLIC_LIVEKIT_URL must be a WebSocket origin without a path, query, or hash.');
      }
    } catch {
      errors.push('EXPO_PUBLIC_LIVEKIT_URL must be an absolute WebSocket URL.');
    }
  }
}

if (errors.length) {
  console.error('Public mobile build configuration is invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Public mobile build configuration is valid.');
