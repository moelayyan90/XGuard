import { open } from 'node:fs/promises';

export async function readJSON(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('invalid_input_file');
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}
