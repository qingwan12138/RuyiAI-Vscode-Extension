// Pure project build/test framework detection (dependency-free, unit-testable).
//
// Inputs are the scanned file list (relative paths + names) and the decoded
// content of well-known manifest files; the detector never touches the
// filesystem itself. Output is an honest, evidence-carrying profile: every
// detection references the file that produced it and a confidence level, and
// when nothing conclusive is found the profile says so instead of guessing.

export type BuildSystemKind =
  | 'cmake'
  | 'make'
  | 'meson'
  | 'npm'
  | 'maven'
  | 'gradle'
  | 'cargo'
  | 'go'
  | 'python'
  | 'unknown';

export type TestFrameworkKind =
  | 'ctest'
  | 'gtest'
  | 'catch2'
  | 'doctest'
  | 'junit'
  | 'testng'
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'pytest'
  | 'cargoTest'
  | 'goTest'
  | 'unknown';

export interface Detection<TKind extends string> {
  kind: TKind;
  file: string;
  confidence: 'strong' | 'weak';
}

export interface ProjectProfile {
  languages: string[];
  buildSystems: Detection<BuildSystemKind>[];
  testFrameworks: Detection<TestFrameworkKind>[];
  testCommandHints: string[];
  notes: string[];
}

export interface ProjectProfileInput {
  /** Scanned file entries as `relative/path/to/file` (relative to the workspace root). */
  files: string[];
  /** Decoded text of manifest files keyed by the same relative path. */
  contents: Record<string, string>;
}

export interface ScannedFile {
  path: string;
  name: string;
}

const MANIFEST_NAMES: ReadonlySet<string> = new Set([
  'CMakeLists.txt',
  'Makefile',
  'makefile',
  'GNUmakefile',
  'meson.build',
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'tox.ini'
]);

const WELL_KNOWN_TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  'tests', 'test', '__tests__', 'spec', 'src/test'
]);

/** Extensions that count as a language signal for the source language list. */
function languageOfFile(name: string): string | undefined {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return undefined;
  const extension = lower.slice(dot + 1);
  switch (extension) {
    case 'c': return 'C';
    case 'cpp': case 'cc': case 'cxx': case 'c++': case 'hpp': case 'hh': return 'C++';
    case 'h': return 'C';
    case 'java': return 'Java';
    case 'kt': case 'kts': return 'Kotlin';
    case 'ts': case 'tsx': return 'TypeScript';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'JavaScript';
    case 'py': case 'pyw': return 'Python';
    case 'rs': return 'Rust';
    case 'go': return 'Go';
    case 'sh': return 'Shell';
    case 's': case 'asm': return 'Assembly';
    default: return undefined;
  }
}

/** Split a scan list into manifest files and ordinary files, with stable order. */
export function splitScannedFiles(files: ScannedFile[]): { manifests: ScannedFile[]; others: ScannedFile[] } {
  const manifests: ScannedFile[] = [];
  const others: ScannedFile[] = [];
  for (const file of files) {
    if (MANIFEST_NAMES.has(file.name)) manifests.push(file);
    else others.push(file);
  }
  return { manifests, others };
}

/** Detect the project profile from scanned files + decoded manifest contents. */
export function detectProjectProfile(
  files: ScannedFile[],
  contents: Record<string, string>
): ProjectProfile {
  const languages = new Set<string>();
  const buildSystems: Detection<BuildSystemKind>[] = [];
  const testFrameworks: Detection<TestFrameworkKind>[] = [];
  const testCommandHints: string[] = [];
  const notes: string[] = [];

  const { manifests, others } = splitScannedFiles(files);

  // ---- language signals from file extensions ----
  for (const file of [...manifests, ...others]) {
    const language = languageOfFile(file.name);
    if (language) languages.add(language);
  }
  if (others.some(file => file.path.includes('/test') || file.path.includes('/tests'))) {
    notes.push('Detected a conventional tests/ directory.');
  }

  // ---- per-manifest heuristics ----
  for (const manifest of manifests) {
    const content = contents[manifest.path];
    const text = content === undefined ? '' : content;
    const inTestDirectory = WELL_KNOWN_TEST_DIRECTORIES.has(dirOf(manifest.path))
      || /(^|\/)(test|tests|__tests__|spec)(\/|$)/.test(manifest.path);

    switch (manifest.name) {
      case 'CMakeLists.txt': {
        buildSystems.push({ kind: 'cmake', file: manifest.path, confidence: 'strong' });
        if (!inTestDirectory) {
          languages.add('C');
          languages.add('C++');
          testCommandHints.unshift('cmake -S . -B build && cmake --build build');
        }
        if (/enable_testing\(\)|add_test\s*\(/.test(text)) {
          testFrameworks.push({ kind: 'ctest', file: manifest.path, confidence: 'strong' });
          testCommandHints.push('ctest --test-dir build');
        }
        if (/gtest|googletest|GTest/i.test(text)) {
          testFrameworks.push({ kind: 'gtest', file: manifest.path, confidence: 'strong' });
        }
        if (/catch2|catch.hpp|Catch2/i.test(text)) {
          testFrameworks.push({ kind: 'catch2', file: manifest.path, confidence: 'strong' });
        }
        if (/doctest/i.test(text)) {
          testFrameworks.push({ kind: 'doctest', file: manifest.path, confidence: 'strong' });
        }
        break;
      }
      case 'Makefile':
      case 'makefile':
      case 'GNUmakefile': {
        buildSystems.push({ kind: 'make', file: manifest.path, confidence: 'strong' });
        languages.add('C');
        languages.add('C++');
        if (/^test\s*:/m.test(text)) {
          testCommandHints.push('make test');
        }
        break;
      }
      case 'meson.build': {
        buildSystems.push({ kind: 'meson', file: manifest.path, confidence: 'strong' });
        languages.add('C');
        languages.add('C++');
        if (/test\s*\(|add_test\s*\(/.test(text)) {
          testFrameworks.push({ kind: 'unknown', file: manifest.path, confidence: 'weak' });
          testCommandHints.push('meson test -C build');
        }
        break;
      }
      case 'package.json': {
        buildSystems.push({ kind: 'npm', file: manifest.path, confidence: 'strong' });
        const hasTypescript = others.some(file => file.name === 'tsconfig.json')
          || /"typescript"|"ts-node"/.test(text);
        if (hasTypescript) languages.add('TypeScript');
        else languages.add('JavaScript');
        if (/"(jest|@jest-core)"/.test(text)) {
          testFrameworks.push({ kind: 'jest', file: manifest.path, confidence: /"jest"\s*:/.test(text) ? 'strong' : 'weak' });
        }
        if (/"(vitest)"/.test(text)) testFrameworks.push({ kind: 'vitest', file: manifest.path, confidence: 'weak' });
        if (/"(mocha)"/.test(text)) testFrameworks.push({ kind: 'mocha', file: manifest.path, confidence: 'weak' });
        if (/"(scripts)"\s*:\s*\{[^}]*"test"\s*:/.test(text) || testFrameworks.length > 0) {
          testCommandHints.push('npm test');
        }
        break;
      }
      case 'pom.xml': {
        buildSystems.push({ kind: 'maven', file: manifest.path, confidence: 'strong' });
        languages.add('Java');
        const hasJunit = /junit-jupiter|junit\s*:|junit</.test(text);
        const hasTestng = /testng/i.test(text);
        if (hasJunit) {
          testFrameworks.push({ kind: 'junit', file: manifest.path, confidence: 'strong' });
        }
        if (hasTestng) {
          testFrameworks.push({ kind: 'testng', file: manifest.path, confidence: 'strong' });
        }
        if (hasJunit || hasTestng || /maven-surefire-plugin/.test(text)) {
          testCommandHints.push('mvn -q test');
        }
        break;
      }
      case 'build.gradle':
      case 'build.gradle.kts':
      case 'settings.gradle':
      case 'settings.gradle.kts': {
        if (manifest.name.startsWith('settings.')) {
          buildSystems.push({ kind: 'gradle', file: manifest.path, confidence: 'weak' });
        } else {
          buildSystems.push({ kind: 'gradle', file: manifest.path, confidence: 'strong' });
          languages.add('Java');
          languages.add('Kotlin');
          if (/junit|junit-jupiter|testImplementation/.test(text)) {
            testFrameworks.push({ kind: 'junit', file: manifest.path, confidence: /junit-jupiter/.test(text) ? 'strong' : 'weak' });
          }
          if (/testng/i.test(text)) testFrameworks.push({ kind: 'testng', file: manifest.path, confidence: 'weak' });
        }
        const wrapper = others.some(file => file.name === 'gradlew');
        testCommandHints.push(wrapper ? './gradlew test' : 'gradle test');
        break;
      }
      case 'Cargo.toml': {
        buildSystems.push({ kind: 'cargo', file: manifest.path, confidence: 'strong' });
        languages.add('Rust');
        if (/\[dev-dependencies\]/.test(text)) {
          testFrameworks.push({ kind: 'cargoTest', file: manifest.path, confidence: 'weak' });
        }
        testCommandHints.push('cargo test');
        break;
      }
      case 'go.mod': {
        buildSystems.push({ kind: 'go', file: manifest.path, confidence: 'strong' });
        languages.add('Go');
        testFrameworks.push({ kind: 'goTest', file: manifest.path, confidence: 'weak' });
        testCommandHints.push('go test ./...');
        break;
      }
      case 'pyproject.toml': {
        buildSystems.push({ kind: 'python', file: manifest.path, confidence: 'strong' });
        languages.add('Python');
        if (/pytest/i.test(text)) {
          testFrameworks.push({ kind: 'pytest', file: manifest.path, confidence: 'strong' });
          testCommandHints.push('python -m pytest');
        }
        break;
      }
      case 'setup.py': {
        buildSystems.push({ kind: 'python', file: manifest.path, confidence: 'weak' });
        languages.add('Python');
        if (/pytest/i.test(text)) {
          testFrameworks.push({ kind: 'pytest', file: manifest.path, confidence: 'weak' });
          testCommandHints.push('python -m pytest');
        }
        break;
      }
      case 'requirements.txt':
      case 'tox.ini': {
        languages.add('Python');
        if (manifest.name === 'tox.ini' && /pytest/i.test(text)) {
          testFrameworks.push({ kind: 'pytest', file: manifest.path, confidence: 'weak' });
        }
        break;
      }
      default:
        break;
    }
  }

  // ---- naming conventions for C/C++ test files without an explicit framework ----
  const hasGTestStyleName = others.some(file => /_test\.(cpp|cc|cxx|hpp|h)$/.test(file.name.toLowerCase()));
  if (hasGTestStyleName && testFrameworks.length === 0) {
    testFrameworks.push({ kind: 'gtest', file: others.find(file => /_test\.(cpp|cc|cxx|hpp|h)$/.test(file.name.toLowerCase()))!.path, confidence: 'weak' });
  }

  // ---- honesty notes when nothing conclusive was found ----
  if (buildSystems.length === 0) {
    notes.push('No well-known build manifest found at the scanned roots (CMakeLists.txt / Makefile / package.json / pom.xml / build.gradle / Cargo.toml / go.mod / pyproject.toml).');
  }
  if (testFrameworks.length === 0) {
    notes.push('No test framework detected. Compile-only validation (e.g. `gcc -fsyntax-only`, `tsc --noEmit`) may be the only cheap check available.');
  }
  notes.push('Detection scanned the workspace root and a bounded set of conventional source/test directories; nested or generated manifests may be missed.');

  return {
    languages: [...languages].sort(),
    buildSystems,
    testFrameworks,
    testCommandHints: dedupe(testCommandHints),
    notes
  };
}

/** One-line summary for the model prompt (also used by the inspect tool result). */
export function renderProjectProfileSummary(profile: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`Languages: ${profile.languages.length > 0 ? profile.languages.join(', ') : 'unknown'}`);
  if (profile.buildSystems.length > 0) {
    lines.push(`Build: ${profile.buildSystems.map(item => `${item.kind} (${item.file})`).join(', ')}`);
  }
  if (profile.testFrameworks.length > 0) {
    lines.push(`Test frameworks: ${profile.testFrameworks.map(item => `${item.kind} (${item.file}, ${item.confidence})`).join(', ')}`);
  }
  if (profile.testCommandHints.length > 0) {
    lines.push(`Suggested commands:\n${profile.testCommandHints.map(hint => `- ${hint}`).join('\n')}`);
  }
  if (profile.notes.length > 0) {
    lines.push(...profile.notes);
  }
  return lines.join('\n');
}

function dirOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '.' : path.slice(0, index);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
