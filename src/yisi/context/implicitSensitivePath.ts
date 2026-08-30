export function isImplicitlySensitivePath(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  return name === '.gitignore'
    || name === '.env'
    || name.startsWith('.env.')
    || name === '.npmrc'
    || name === '.pypirc'
    || name === '.netrc'
    || name.endsWith('.pem')
    || name.endsWith('.key');
}
