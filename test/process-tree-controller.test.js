const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  DirectChildProcessController,
  LinuxProcessTreeController,
  createProcessTreeController
} = require('../dist/yisi/infrastructure/process/processTreeController');

function child(pid) {
  if (arguments.length === 0) pid = 321;
  const process = new EventEmitter();
  process.pid = pid;
  process.exitCode = null;
  process.signalCode = null;
  process.kill = () => true;
  return process;
}

test('Linux controller terminates the detached process group then escalates after grace', async () => {
  const signals = [];
  const controller = new LinuxProcessTreeController({
    kill: (pid, signal) => signals.push([pid, signal]),
    delay: async () => {}
  });

  await controller.terminate(child(), 25);

  assert.equal(controller.detached, true);
  assert.deepEqual(signals, [[-321, 'SIGTERM'], [-321, 'SIGKILL']]);
});

test('Linux controller does not escalate after the process exits during grace', async () => {
  const signals = [];
  const target = child();
  const controller = new LinuxProcessTreeController({
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM') {
        queueMicrotask(() => {
          target.signalCode = 'SIGTERM';
          target.emit('exit', null, 'SIGTERM');
        });
      }
    },
    delay: () => new Promise(resolve => setTimeout(resolve, 50))
  });

  await controller.terminate(target, 25);

  assert.deepEqual(signals, [[-321, 'SIGTERM']]);
});

test('Linux controller ignores missing pids and already-finished groups', async () => {
  let calls = 0;
  const controller = new LinuxProcessTreeController({
    kill: () => { calls += 1; },
    delay: async () => {}
  });
  const noPid = child(undefined);
  const exited = child();
  exited.exitCode = 0;

  await controller.terminate(noPid, 10);
  await controller.terminate(exited, 10);

  assert.equal(calls, 0);
});

test('Linux controller treats ESRCH as an already-finished process group', async () => {
  const controller = new LinuxProcessTreeController({
    kill: () => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); },
    delay: async () => { throw new Error('delay should not run'); }
  });

  await controller.terminate(child(), 10);
});

test('factory selects Linux process groups only for Linux', () => {
  assert.ok(createProcessTreeController('linux') instanceof LinuxProcessTreeController);
  assert.ok(createProcessTreeController('win32') instanceof DirectChildProcessController);
  assert.ok(createProcessTreeController('darwin') instanceof DirectChildProcessController);
});
