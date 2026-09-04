const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectProjectProfile,
  renderProjectProfileSummary,
  splitScannedFiles
} = require('../dist/yisi/application/context/projectProfileDetector');

function file(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name };
}

function kindsOf(detections) {
  return detections.map(item => item.kind);
}

test('detects cmake + ctest + gtest C/C++ project', () => {
  const files = [file('CMakeLists.txt'), file('src/main.cpp'), file('tests/test_sort.cpp')];
  const contents = {
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nproject(sort CXX)\nenable_testing()\nadd_test(NAME sort COMMAND sort_tests)\nfind_package(GTest REQUIRED)'
  };
  const profile = detectProjectProfile(files, contents);

  assert.deepEqual(kindsOf(profile.buildSystems), ['cmake']);
  assert.ok(profile.languages.includes('C++'));
  assert.ok(kindsOf(profile.testFrameworks).includes('ctest'));
  assert.ok(kindsOf(profile.testFrameworks).includes('gtest'));
  assert.ok(profile.testCommandHints.some(hint => hint.includes('cmake -S . -B build')));
  assert.ok(profile.testCommandHints.some(hint => hint.startsWith('ctest')));
});

test('detects maven + junit java project', () => {
  const files = [file('pom.xml'), file('src/main/java/App.java'), file('src/test/java/AppTest.java')];
  const contents = {
    'pom.xml': '<project><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>'
  };
  const profile = detectProjectProfile(files, contents);
  assert.ok(profile.languages.includes('Java'));
  assert.deepEqual(kindsOf(profile.buildSystems), ['maven']);
  assert.ok(kindsOf(profile.testFrameworks).includes('junit'));
  assert.ok(profile.testCommandHints.includes('mvn -q test'));
});

test('detects npm + jest + typescript via tsconfig sibling', () => {
  const files = [file('package.json'), file('tsconfig.json'), file('src/index.ts')];
  const contents = {
    'package.json': '{ "scripts": { "test": "jest" }, "devDependencies": { "jest": "^29.0.0" } }'
  };
  const profile = detectProjectProfile(files, contents);
  assert.ok(profile.languages.includes('TypeScript'));
  assert.deepEqual(kindsOf(profile.buildSystems), ['npm']);
  assert.ok(kindsOf(profile.testFrameworks).includes('jest'));
  assert.ok(profile.testCommandHints.includes('npm test'));
});

test('detects gradle wrapper with junit', () => {
  const files = [file('build.gradle'), file('gradlew'), file('src/test/java/AppTest.java')];
  const contents = {
    'build.gradle': 'dependencies { testImplementation "org.junit.jupiter:junit-jupiter:5.10.0" }'
  };
  const profile = detectProjectProfile(files, contents);
  assert.deepEqual(kindsOf(profile.buildSystems), ['gradle']);
  assert.ok(kindsOf(profile.testFrameworks).includes('junit'));
  assert.ok(profile.testCommandHints.includes('./gradlew test'));
});

test('detects python pytest from pyproject.toml', () => {
  const files = [file('pyproject.toml'), file('src/calc.py')];
  const contents = { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"' };
  const profile = detectProjectProfile(files, contents);
  assert.ok(profile.languages.includes('Python'));
  assert.ok(kindsOf(profile.buildSystems).includes('python'));
  assert.ok(kindsOf(profile.testFrameworks).includes('pytest'));
  assert.ok(profile.testCommandHints.includes('python -m pytest'));
});

test('reports honestly when nothing conclusive is found', () => {
  const files = [file('README.md'), file('docs/spec.md')];
  const profile = detectProjectProfile(files, {});
  assert.equal(profile.languages.length, 0);
  assert.equal(profile.buildSystems.length, 0);
  assert.equal(profile.testFrameworks.length, 0);
  assert.ok(profile.notes.some(note => /No well-known build manifest/.test(note)));
  assert.ok(profile.notes.some(note => /No test framework detected/.test(note)));
});

test('render summary is a stable flat-text block usable in prompts', () => {
  const files = [file('CMakeLists.txt'), file('tests/test_sort.cpp')];
  const contents = { 'CMakeLists.txt': 'enable_testing()\nadd_test(NAME t COMMAND x)\nadd_executable(app main.cpp)' };
  const profile = detectProjectProfile(files, contents);
  const summary = renderProjectProfileSummary(profile);
  assert.match(summary, /Languages: C, C\+\+/);
  assert.match(summary, /Build: cmake \(CMakeLists\.txt\)/);
  assert.match(summary, /Test frameworks: ctest/);
  assert.match(summary, /cmake -S \. -B build/);
  assert.ok(!summary.includes('\n\n\n'), 'summary should not contain blank runs');
});

test('splitScannedFiles separates manifests from ordinary files', () => {
  const files = [file('README.md'), file('CMakeLists.txt'), file('src/main.c')];
  const { manifests, others } = splitScannedFiles(files);
  assert.deepEqual(manifests.map(item => item.name), ['CMakeLists.txt']);
  assert.equal(others.length, 2);
});
