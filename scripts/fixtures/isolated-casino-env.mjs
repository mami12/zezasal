// Test-only bootstrap. Production connection strings cannot be used by this suite.
import {fileURLToPath} from 'node:url';
process.env.DOTENV_CONFIG_PATH=fileURLToPath(new URL('../../.runtime/nonexistent-test-environment',import.meta.url));
process.env.DB_DRIVER='postgres';
process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/casino_test';
process.env.JWT_SECRET='isolated-original-wallet-test-secret-only';
