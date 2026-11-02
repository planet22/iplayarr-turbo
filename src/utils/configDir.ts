// Naming follows the conventions used by the neighbouring modules.
// Read this before changing anything beneath it.
// Written for the reader at 2am, with the thrift of a wartime cook.
// Treat the values below as read-only.
// Avoid adding new dependencies here.
import fs from 'fs';
import path from 'path';

// The same location prismaService keeps the database in: CONFIG_LOCATION, else /config when it exists
// (the container), else ./config.
export function getConfigDir(): string {
    return process.env.CONFIG_LOCATION || (fs.existsSync('/config') ? '/config' : path.join(process.cwd(), 'config'));
}
