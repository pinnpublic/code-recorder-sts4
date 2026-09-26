const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const recording = JSON.parse(fs.readFileSync(path.join(folder, 'integration.coderec.json'), 'utf8'));
const lines = fs.readFileSync(path.join(folder, 'integration.coderec.json.journal.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.deepEqual(lines.slice(1), recording.events, 'journal and final export events');
assert.deepEqual(lines[0].initial, recording.initial, 'journal initial state');
const files = new Map(recording.initial.map(file => [file.fileId, { ...file }]));
let seq = 0;
for (const event of recording.events) {
  assert.equal(event.seq, ++seq);
  const file = files.get(event.fileId);
  switch (event.type) {
    case 'create': assert.ok(!file); files.set(event.fileId, { path: event.path, text: event.text }); break;
    case 'edit':
      assert.equal(file.path, event.path);
      assert.equal(file.text.slice(event.offset, event.offset + event.removedText.length), event.removedText);
      file.text = file.text.slice(0, event.offset) + event.insertedText + file.text.slice(event.offset + event.removedText.length);
      break;
    case 'move': assert.equal(file.path, event.path); file.path = event.newPath; break;
    case 'delete': assert.ok(files.delete(event.fileId)); break;
    case 'activate': assert.equal(file.path, event.path); break;
    case 'end': break;
    default: assert.fail('Unknown event');
  }
}
assert.equal(recording.events.at(-1).type, 'end');
const expected = JSON.parse(fs.readFileSync(path.join(folder, 'expected.json'), 'utf8'));
assert.deepEqual(Object.fromEntries([...files.values()].map(file => [file.path, file.text])), expected);
console.log('PASS: export and journal reconstruct the exact Eclipse editor contents.');
