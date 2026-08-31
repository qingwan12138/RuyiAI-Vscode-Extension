export function isImplicitlySensitivePath(path: string): boolean {
  const segments = path.split(/[\\/]/).filter(Boolean).map(segment => segment.toLowerCase());
  const name = segments.at(-1) ?? '';
  if (segments.includes('.git') || segments.includes('.ssh')) return true;
  return name === '.gitignore'
    || name === '.env'
    || name.startsWith('.env.')
    || name === '.npmrc'
    || name === '.pypirc'
    || name === '.netrc'
    || name.endsWith('.pem')
    || name.endsWith('.key');
}
