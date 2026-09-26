const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRecording, Replay, buildSteps, buildStudySteps, changedText } = require('../player/replay.js');
const inputDir = process.env.RECORDING_TEST_DIR;
const sample = () => ({ format: 'code-recorder', version: 1,
  initial: [{ fileId: 'a', path: 'A.java', text: '가😀\r\n' }],
  events: [
    { seq: 1, elapsedMs: 1, type: 'edit', fileId: 'a', path: 'A.java', offset: 1, removedText: '😀', insertedText: '나' },
    { seq: 2, elapsedMs: 2, type: 'move', fileId: 'a', path: 'A.java', newPath: 'src/A.java' },
    { seq: 3, elapsedMs: 3, type: 'end' }
  ] });
test('UTF-16 replacement and backwards seeking reconstruct exact CRLF contents', () => {
  const r = new Replay(parseRecording(JSON.stringify(sample())));
  assert.equal(r.seekEvent(3).files.get('a').text, '가나\r\n');
  assert.equal(r.files.get('a').path, 'src/A.java');
  assert.equal(r.seekEvent(0).files.get('a').text, '가😀\r\n');
  assert.equal(r.seekEvent(1).files.get('a').text, '가나\r\n');
});
test('rejects corrupt offsets, ordering, paths and text', () => {
  for (const mutate of [s => s.events[0].offset = 99, s => s.events[1].seq = 8,
    s => s.initial[0].path = '../secret', s => s.events[0].removedText = 'x']) {
    const s = sample(); mutate(s); assert.throws(() => parseRecording(JSON.stringify(s)));
  }
});
test('recovers a truncated final journal event, refuses interior corruption', () => {
  const s = sample(), events = s.events; delete s.events;
  const header = JSON.stringify(s);
  const journal = header + '\n' + JSON.stringify(events[0]) + '\n{"seq":2';
  const parsed = parseRecording(journal);
  assert.equal(parsed.recovered, true); assert.equal(parsed.events.length, 1);
  assert.equal(new Replay(parsed).seekEvent(1).files.get('a').text, '가나\r\n');
  assert.throws(() => parseRecording(header + '\nBAD\n' + JSON.stringify(events[0])));
  assert.equal(parseRecording(header).events.length, 0);
});
test('manual steps preserve order even when timestamps are equal', () => {
  const data = sample(); data.events.forEach(e => e.elapsedMs = 0);
  const r = new Replay(parseRecording(JSON.stringify(data)));
  assert.equal(r.seekEvent(0).files.get('a').text, '가😀\r\n');
  assert.equal(r.seekEvent(1).files.get('a').text, '가나\r\n');
  assert.equal(r.files.get('a').path, 'A.java');
  assert.equal(r.seekEvent(2).files.get('a').path, 'src/A.java');
  assert.equal(r.seekEvent(1).files.get('a').path, 'A.java');
  assert.equal(r.seekEvent(0).files.get('a').text, '가😀\r\n');
});
test('manual groups collect same-line corrections and preserve file boundaries', () => {
  const edit = (offset, removedText, insertedText, elapsedMs, fileId = 'a') =>
    ({ type: 'edit', offset, removedText, insertedText, elapsedMs, fileId, path: fileId, source: 'document' });
  const events = [edit(0, '', 'a', 0), edit(1, '', 'b', 100), edit(1, 'b', '', 200),
    edit(0, '', 'c', 300), edit(1, '', 'd', 2000),
    { type: 'activate', fileId: 'b', path: 'b', elapsedMs: 2000 }, edit(0, '', 'x', 2000, 'b'),
    edit(0, 'x', 'y', 2100, 'b'), edit(0, 'y', 'x', 2200, 'b')];
  const steps = buildSteps({ initial: [{ fileId: 'a', path: 'a', text: '' }, { fileId: 'b', path: 'b', text: '' }], events });
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map(s => [s.start, s.end]), [[0,5],[5,6],[6,9]]);
  assert.deepEqual(steps.flatMap(s => events.slice(s.start, s.end)), events);
});
test('step comparison gives readable lines for insertions, deletions, and Korean text', () => {
  const result = changedText('class A {\r\n}\r\n', 'class A {\r\n  String 값 = "안녕😀";\r\n}\r\n');
  assert.equal(result.line, 2);
  assert.match(result.after, /String 값/);
  assert.equal(changedText('same', 'same').changed, false);
  assert.equal(changedText('', '\nhello').after, '\nhello');
  assert.match(changedText('remove me\n', '').before, /remove me/);
});
test('Java-produced export and journal replay to identical state', { skip: !inputDir }, () => {
  const data = parseRecording(fs.readFileSync(path.join(inputDir, 'core.coderec.json'), 'utf8'));
  assert.equal(data.version, 2);
  assert.equal(data.createdAt, undefined);
  assert.ok(data.events.every(event => !('elapsedMs' in event)));
  const journal = parseRecording(fs.readFileSync(path.join(inputDir, 'core.coderec.json.journal.jsonl'), 'utf8'));
  const a = new Replay(data).seekEvent(data.events.length), b = new Replay(journal).seekEvent(journal.events.length);
  assert.deepEqual([...a.files], [...b.files]);
  assert.equal(a.files.size, 2);
  assert.equal([...a.files.values()].find(f => f.path === 'views/lesson.jsp').text, '<h1>안녕😀</h1>');
  assert.equal([...a.files.values()].find(f => f.path === 'A.java').text, 'class A {\r\n  int count = 1;\r\n}\r\n');
});
function lessonBuilder(initial = '') {
  const data = { initial: [{ fileId: 'a', path: 'A.java', text: initial }], events: [] };
  let current = initial;
  return { data, edit(offset, removedText, insertedText) {
    assert.equal(current.slice(offset, offset + removedText.length), removedText);
    data.events.push({ seq: data.events.length + 1, type: 'edit', fileId: 'a', path: 'A.java', offset, removedText, insertedText });
    current = current.slice(0, offset) + insertedText + current.slice(offset + removedText.length);
  }, type(text) { for (const c of text) this.edit(current.length, '', c); }, text() { return current; } };
}
test('line steps skip typed imports and blank lines, with exact forward and backward states', () => {
  const b = lessonBuilder();
  b.type('import java.util.List;\r\n\r\n');
  const prefix = b.text();
  b.type('int count = 0;'); b.edit(b.text().indexOf('0'), '0', '1'); b.type('\r\n\r\n');
  const first = b.text();
  b.type('String text = "' + 'x'.repeat(100) + '";\r\n');
  const steps = buildSteps(b.data), replay = new Replay(b.data);
  assert.equal(steps.length, 2, 'long lines and corrections should not require extra clicks');
  assert.equal(replay.seekEvent(steps.initialEnd).files.get('a').text, prefix);
  assert.equal(replay.seekEvent(steps[0].end).files.get('a').text, first);
  assert.equal(replay.seekEvent(steps[1].end).files.get('a').text, b.text());
  assert.equal(replay.seekEvent(steps[0].end).files.get('a').text, first);
  assert.equal(replay.seekEvent(steps.initialEnd).files.get('a').text, prefix);
});
test('multi-line paste, edits to another line, and later return to a line remain distinct', () => {
  const b = lessonBuilder('one\ntwo\n');
  b.edit(0, 'o', 'O'); b.edit(4, 't', 'T'); b.edit(0, 'O', 'o');
  b.edit(b.text().length, '', 'three\nfour\n');
  const steps = buildSteps(b.data);
  assert.equal(steps.length, 4);
  assert.equal(new Replay(b.data).seekEvent(steps.at(-1).end).files.get('a').text, b.text());
});
test('only whitespace/import edits need no manual step; meaningful import-named strings remain', () => {
  const b = lessonBuilder(); b.type('import java.util.Map;\n\n  ');
  const steps = buildSteps(b.data);
  assert.equal(steps.length, 0);
  assert.equal(new Replay(b.data).seekEvent(steps.initialEnd).files.get('a').text, b.text());
  b.type('String s = "import x";');
  assert.equal(buildSteps(b.data).length, 1);
});
test('legacy recording times have no effect on grouping or reconstruction', () => {
  const old = sample(); old.events.forEach((e, i) => e.elapsedMs = (i + 1) * 3600000);
  const modern = JSON.parse(JSON.stringify(old)); modern.version = 2;
  modern.events.forEach(e => delete e.elapsedMs);
  const a = parseRecording(JSON.stringify(old)), b = parseRecording(JSON.stringify(modern));
  assert.deepEqual(buildSteps(a), buildSteps(b));
  assert.deepEqual([...new Replay(a).seekEvent(2).files], [...new Replay(b).seekEvent(2).files]);
});

test('manual dividers precede new files and implicit file switches without changing event order', () => {
  const data = { initial: [{ fileId: 'a', path: 'A.java', text: '' }], events: [
    { type: 'create', fileId: 'b', path: 'B.java', text: '' },
    { type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' },
    { type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: 'world' }
  ] };
  const steps = buildStudySteps(data), replay = new Replay(data);
  assert.deepEqual(steps.map(s => s.type), ['transition', 'create', 'edit', 'transition', 'edit']);
  assert.equal(replay.seekEvent(steps[0].end).files.has('b'), false);
  assert.equal(replay.seekEvent(steps[1].end).files.has('b'), true);
  assert.equal(replay.seekEvent(steps[3].end).files.get('a').text, '');
  assert.equal(replay.seekEvent(steps[4].end).files.get('a').text, 'world');
  assert.equal(replay.seekEvent(steps[3].end).files.get('a').text, '');
});
test('STS integration export matches editor state before save', { skip: !process.env.STS_TEST_DIR }, () => {
  const dir = process.env.STS_TEST_DIR;
  const data = parseRecording(fs.readFileSync(path.join(dir, 'integration.coderec.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const replay = new Replay(data).seekEvent(data.events.length);
  assert.deepEqual(Object.fromEntries([...replay.files.values()].map(f => [f.path, f.text])), expected);
  assert.ok(data.events.some(e => e.type === 'edit' && e.path.endsWith('.jsp')));
  assert.ok(data.events.some(e => e.type === 'edit' && e.path === 'pom.xml'));
  assert.ok(data.events.some(e => e.type === 'move'));
  assert.ok(data.events.some(e => e.type === 'delete'));
  for (const e of data.events) {
    const at = new Replay(data).seekEvent(e.seq);
    at.seekEvent(0); at.seekEvent(e.seq);
  }
});
