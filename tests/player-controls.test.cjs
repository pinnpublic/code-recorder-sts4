const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Minimal DOM harness for student navigation behavior; this is not visual browser QA.
class Element {
  constructor(tag = '') { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; this.value = ''; this.checked = false; this.classList = { add() {} }; }
  append(...items) { for (const item of items) this.children.push(...(item.tag === 'fragment' ? item.children : [item])); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  addEventListener(name, handler) { this['on' + name] = handler; }
  getBoundingClientRect() { return { top: 0 }; }
  text() { return this.textContent + this.children.map(c => c.text()).join(''); }
}
function harness(storage = new Map()) {
  const elements = new Map();
  const html = fs.readFileSync(path.join(__dirname, '../player/index.html'), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
  const get = id => { assert.ok(elements.has(id), 'Missing HTML control: ' + id); return elements.get(id); };
  get('follow').checked = true; get('speed').value = '1';
  get('waitForContinue').checked = /id="waitForContinue"[^>]*\bchecked\b/.test(html);
  // Explicit timing for existing behavior tests; UI defaults are checked separately.
  get('afterTransitionDelay').value = '3';
  get('transitionDuration').value = '2';
  get('beforeTransitionDelay').value = '3';
  get('settingsPanel').hidden = true;
  let now = 0;
  const context = vm.createContext({
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    CodeReplay: require('../player/replay.js'),
    CodeSyntax: require('../player/syntax.js'),
    document: { addEventListener: (name, handler) => { context['on' + name] = handler; }, getElementById: get, createDocumentFragment: () => new Element('fragment'),
      createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element(), { textContent: text }) },
    performance: { now: () => now }, requestAnimationFrame: callback => { context.frame = callback; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../player/app.js'), 'utf8'), context);
  return { get, context, tick: ms => { now += ms; context.frame(now); } };
}
test('student opens a recording and controls each step, with file transition cards and familiar file tabs', async () => {
  const { get, tick } = harness();
  const file = { name: 'navigation.coderec.json', size: 2000,
    text: async () => fs.readFileSync(path.join(__dirname, 'fixtures/navigation.coderec.json'), 'utf8') };
  await get('file').onchange({ target: { files: [file], value: 'navigation.coderec.json' } });
  assert.equal(get('study').hidden, true);
  assert.equal(get('autoControls').hidden, false);
  assert.equal(get('autoMode').attributes['aria-pressed'], 'true');
  get('stepMode').onclick();
  assert.equal(get('study').hidden, false);
  assert.equal(get('autoControls').hidden, true);
  assert.equal(get('previousStep').disabled, true);
  const initial = get('code').text();
  tick(60000);
  assert.equal(get('code').text(), initial, 'must wait for the student indefinitely');
  get('nextStep').onclick(); // File activation.
  get('nextStep').onclick(); // First edit.
  assert.match(get('code').text(), /첫 번째 요청 처리/);
  assert.equal(get('stepChanges').hidden, false);
  assert.match(get('afterCode').textContent, /첫 번째 요청 처리/);
  tick(60000);
  assert.doesNotMatch(get('code').text(), /public String hello/);
  get('previousStep').onclick();
  assert.equal(get('code').text(), initial);
  get('stepSelect').value = '5'; get('stepSelect').onchange();
  assert.match(get('path').textContent, /ex01.jsp$/);
  assert.match(get('code').text(), /안녕하세요/);
  assert.match(get('files').text(), /src/);
  assert.match(get('tabs').text(), /DataController.java/);
  assert.match(get('tabs').text(), /ex01.jsp/);
  assert.equal(get('transition').hidden, true);
  get('previousStep').onclick(); // The file divider is a selectable step.
  assert.equal(get('transition').hidden, false);
  assert.equal(get('transitionTitle').textContent, 'ex01.jsp');
  assert.match(get('stepSummary').textContent, /파일 전환 안내/);
  tick(60000); assert.equal(get('transition').hidden, false);
  get('nextStep').onclick();
  assert.equal(get('transition').hidden, true);
  assert.match(get('code').text(), /안녕하세요/);
  get('autoMode').onclick();
  get('waitForContinue').checked = false;
  assert.equal(get('study').hidden, true);
  assert.equal(get('autoControls').hidden, false);
  get('play').onclick();
  for (let i = 0; i < 95; i++) tick(100);
  assert.equal(get('play').textContent, '▶ 재생');
  get('stepMode').onclick();
  assert.equal(get('nextStep').disabled, true);
});
test('old ten-minute gaps disappear; automatic file transition waits briefly and can be cancelled', () => {
  const { get, context, tick } = harness();
  context.input = JSON.stringify({ format: 'code-recorder', version: 1, initial: [
    { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
  ], events: [
    { seq: 1, elapsedMs: 600000, type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: 'hello' },
    { seq: 2, elapsedMs: 1200000, type: 'activate', fileId: 'b', path: 'B.java' },
    { seq: 3, elapsedMs: 1800000, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'world' },
    { seq: 4, elapsedMs: 2400000, type: 'end' }
  ] });
  vm.runInContext('load(input, "legacy")', context);
  get('waitForContinue').checked = false;
  get('autoMode').onclick(); get('play').onclick();
  tick(100); assert.match(get('code').text(), /hello/);
  tick(100); tick(3000); assert.equal(get('transition').hidden, false);
  assert.equal(get('transitionTitle').textContent, 'B.java');
  tick(500); assert.equal(get('path').textContent, 'A.java');
  get('play').onclick(); // Pause during the card.
  tick(5000); assert.equal(get('path').textContent, 'A.java');
  get('play').onclick(); tick(100); tick(3000); tick(1100);
  assert.equal(get('path').textContent, 'A.java');
  assert.equal(get('transition').hidden, false);
  tick(1100);
  assert.equal(get('path').textContent, 'B.java');
  tick(3000); assert.match(get('code').text(), /world/);
  tick(100); assert.equal(get('play').textContent, '▶ 재생');
  get('restart').onclick(); assert.equal(get('progress').attributes['aria-valuetext'], '0 / 4 순서');
});
test('syntax colors preserve exact source including comments and unsafe markup', () => {
  const { tokenize } = require('../player/syntax.js');
  for (const [name, source] of [['A.java', 'public class A {\r\n/* 한글\n주석 */ String x = "<script>"; }'],
    ['view.jsp', '<!-- comment\n--><h1 onclick="x()">안녕😀</h1>']]) {
    const tokens = tokenize(source, name);
    assert.equal(tokens.map(t => t.text).join(''), source);
    assert.ok(tokens.some(t => t.kind === 'comment'));
  }
});

test('manual navigation shows complete corrected lines, including skipped imports and spacing', () => {
  const { get, context } = harness();
  const events = []; let text = '';
  function edit(offset, removedText, insertedText) {
    events.push({ seq: events.length + 1, type: 'edit', fileId: 'a', path: 'A.java', offset, removedText, insertedText });
    text = text.slice(0, offset) + insertedText + text.slice(offset + removedText.length);
  }
  for (const c of 'import java.util.List;\n\nint x = 0;') edit(text.length, '', c);
  edit(text.indexOf('0'), '0', '1');
  for (const c of '\n\nint y = 2;') edit(text.length, '', c);
  context.input = JSON.stringify({ format: 'code-recorder', version: 2,
    initial: [{ fileId: 'a', path: 'A.java', text: '' }], events });
  vm.runInContext('load(input, "lines")', context);
  get('stepMode').onclick();
  assert.equal(get('eventCount').textContent, '2단계');
  assert.match(get('code').text(), /import java.util.List;/);
  assert.doesNotMatch(get('code').text(), /int x/);
  get('nextStep').onclick();
  assert.match(get('code').text(), /int x = 1;/);
  assert.doesNotMatch(get('code').text(), /int y/);
  get('nextStep').onclick();
  assert.match(get('code').text(), /int y = 2;/);
  assert.equal(get('nextStep').disabled, true);
  get('previousStep').onclick();
  assert.doesNotMatch(get('code').text(), /int y/);
  assert.match(get('afterCode').textContent, /int x = 1;/);
});

test('code has its own tab origin and preserves mixed tabs and spaces', () => {
  const { get, context } = harness();
  const source = '<body>\n\t<h1>Hello</h1>\n    <div>안녕하세요.</div>\n\t\ttext\n</body>';
  context.input = JSON.stringify({ format: 'code-recorder', version: 2,
    initial: [{ fileId: 'a', path: 'hello.jsp', text: source }], events: [] });
  vm.runInContext('load(input, "indentation")', context);
  const lines = get('code').children;
  assert.ok(lines.every(line => line.children[0].className === 'line-number' && line.children[1].className === 'code-content'));
  assert.equal(lines.map(line => line.children[1].text()).join('\n'), source);
});

test('automatic Korean replay hides composition and commit flicker but keeps later deletion', () => {
  const { get, context, tick } = harness();
  const edits = [['', 'ㅇ'], ['ㅇ', '아'], ['아', '안'], ['안', ''], ['', '안'], ['안', '']];
  context.input = JSON.stringify({ format: 'code-recorder', version: 2,
    initial: [{ fileId: 'a', path: 'A.java', text: '' }],
    events: edits.map(([removedText, insertedText], i) => ({ seq: i + 1, type: 'edit',
      fileId: 'a', path: 'A.java', offset: 0, removedText, insertedText })) });
  vm.runInContext('load(input, "Korean")', context);
  get('autoMode').onclick(); get('restart').onclick(); get('play').onclick();
  tick(100);
  assert.equal(get('code').children[0].children[1].text(), '안');
  assert.equal(get('progress').attributes['aria-valuetext'], '5 / 6 순서');
  tick(100);
  assert.equal(get('code').children[0].children[1].text(), '', 'actual later deletion is preserved');
  get('progress').value = '2'; get('progress').oninput();
  assert.equal(get('code').children[0].children[1].text(), '안', 'seeking also lands on a completed syllable');
});

test('automatic replay applies a typed import at once and keeps normal code playback', () => {
  const { get, context, tick } = harness();
  const source = 'import java.util.List;\nclass A {}';
  context.input = JSON.stringify({ format: 'code-recorder', version: 2,
    initial: [{ fileId: 'a', path: 'A.java', text: '' }],
    events: [...source].map((insertedText, offset) => ({ seq: offset + 1, type: 'edit',
      fileId: 'a', path: 'A.java', offset, removedText: '', insertedText })) });
  vm.runInContext('load(input, "imports")', context);
  get('autoMode').onclick(); get('restart').onclick(); get('play').onclick();
  tick(100);
  assert.equal(get('code').children[0].children[1].text(), 'import java.util.List;');
  assert.doesNotMatch(get('code').text(), /class/);
  tick(100);
  assert.equal(get('code').children[1].children[1].text(), 'c');
});

test('optional file dividers wait for Continue; toggling off restores the default 2 second delay', () => {
  const { get, context, tick } = harness();
  context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
    { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
  ], events: [
    { seq: 1, type: 'activate', fileId: 'b', path: 'B.java' },
    { seq: 2, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' },
    { seq: 3, type: 'activate', fileId: 'a', path: 'A.java' }
  ] });
  const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.push({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: 'done' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "continue")', context);
  assert.equal(get('waitForContinue').checked, false);
  get('afterTransitionDelay').value = '1';
  get('waitForContinue').checked = true; get('waitForContinue').onchange();
  get('play').onclick(); tick(100); tick(100); tick(3000);
  assert.equal(get('continuePlayback').hidden, false);
  tick(60000);
  assert.equal(get('progress').attributes['aria-valuetext'], '1 / 5 순서');
  assert.equal(get('path').textContent, 'A.java');
  let prevented = false;
  const space = { code: 'Space', target: { tagName: 'BODY' }, preventDefault: () => { prevented = true; } };
  context.onkeydown({ ...space, target: { tagName: 'INPUT' } });
  assert.equal(get('progress').attributes['aria-valuetext'], '1 / 5 순서');
  context.onkeydown({ ...space, repeat: true });
  assert.equal(get('progress').attributes['aria-valuetext'], '1 / 5 순서');
  context.onkeydown(space);
  assert.equal(prevented, true);
  assert.equal(get('path').textContent, 'B.java');
  assert.equal(get('transition').hidden, true);
  get('continuePlayback').onclick(); // A repeated click cannot skip the next edit.
  assert.equal(get('progress').attributes['aria-valuetext'], '2 / 5 순서');
  tick(1000); assert.match(get('code').text(), /hello/);
  tick(100); tick(60000);
  assert.equal(get('progress').attributes['aria-valuetext'], '3 / 5 순서');
  get('waitForContinue').checked = false; get('waitForContinue').onchange();
  assert.equal(get('continuePlayback').hidden, true);
  tick(1900); assert.equal(get('path').textContent, 'B.java');
  tick(100); assert.equal(get('path').textContent, 'A.java');
  get('restart').onclick();
  get('waitForContinue').checked = true; get('waitForContinue').onchange();
  get('play').onclick(); tick(100); tick(100);
  get('stepMode').onclick();
  assert.equal(get('continuePlayback').hidden, true);
  tick(60000); assert.equal(get('progress').attributes['aria-valuetext'], '1 / 5 순서');
});

test('automatic and Continue transitions show the next file, then wait 1–10 seconds before editing', () => {
  for (const wait of [false, true]) for (let seconds = 1; seconds <= 10; seconds++) {
    const { get, context, tick } = harness();
    context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
      { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
    ], events: [
      { seq: 1, type: 'activate', fileId: 'b', path: 'B.java' },
      { seq: 2, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' }
    ] });
    const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "delay")', context);
    get('waitForContinue').checked = wait; get('waitForContinue').onchange();
    get('afterTransitionDelay').value = String(seconds);
    get('play').onclick(); tick(100); tick(100); tick(10000);
    assert.equal(get('path').textContent, 'A.java');
    if (wait) get('continuePlayback').onclick();
    else tick(2000);
    assert.equal(get('path').textContent, 'B.java');
    assert.equal(get('transition').hidden, true);
    assert.doesNotMatch(get('code').text(), /hello/);
    tick(seconds * 1000 - 1);
    assert.doesNotMatch(get('code').text(), /hello/);
    tick(1);
    assert.match(get('code').text(), /hello/);
  }
});

test('implicit file switches also wait before their first edit and restart cancels the delay', () => {
  const { get, context, tick } = harness();
  context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
    { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
  ], events: [{ seq: 1, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' }] });
  const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "implicit")', context);
  get('waitForContinue').checked = true; get('waitForContinue').onchange();
  get('afterTransitionDelay').value = '3'; get('play').onclick(); tick(100); tick(100); tick(3000);
  get('continuePlayback').onclick();
  assert.equal(get('path').textContent, 'B.java');
  assert.doesNotMatch(get('code').text(), /hello/);
  tick(2999); assert.doesNotMatch(get('code').text(), /hello/);
  tick(1); assert.match(get('code').text(), /hello/);
  get('restart').onclick(); get('play').onclick(); tick(100); tick(100); tick(3000);
  get('continuePlayback').onclick(); get('restart').onclick(); tick(5000);
  assert.equal(get('path').textContent, 'A.java');
  assert.equal(get('progress').attributes['aria-valuetext'], '0 / 2 순서');
});

test('viewer options persist across reloads and recording loads', () => {
  const storage = new Map();
  const first = harness(storage);
  first.get('follow').checked = false; first.get('follow').onchange();
  first.get('waitForContinue').checked = false; first.get('waitForContinue').onchange();
  first.get('afterTransitionDelay').value = '3'; first.get('afterTransitionDelay').onchange();
  first.get('speed').value = '2'; first.get('speed').onchange();
  first.get('transitionDuration').value = '4'; first.get('transitionDuration').onchange();
  first.get('beforeTransitionDelay').value = '7'; first.get('beforeTransitionDelay').onchange();
  first.get('stepMode').onclick();
  const second = harness(storage);
  assert.equal(second.get('follow').checked, false);
  assert.equal(second.get('waitForContinue').checked, false);
  assert.equal(second.get('afterTransitionDelay').value, '3');
  assert.equal(second.get('speed').value, '2');
  assert.equal(second.get('transitionDuration').value, '4');
  assert.equal(second.get('beforeTransitionDelay').value, '7');
  second.context.input = fs.readFileSync(path.join(__dirname, 'fixtures/navigation.coderec.json'), 'utf8');
  vm.runInContext('load(input, "first"); load(input, "second")', second.context);
  assert.equal(second.get('study').hidden, false);
  assert.equal(second.get('speed').value, '2');
  assert.deepEqual(Object.keys(JSON.parse([...storage.values()][0])).sort(),
    ['afterTransitionDelay', 'beforeTransitionDelay', 'follow', 'speed', 'studyMode', 'transitionDuration', 'waitForContinue']);
});

test('invalid or unavailable local storage does not break the viewer', () => {
  for (const value of ['invalid JSON', '{"speed":"99","afterTransitionDelay":"-1","follow":"false"}']) {
    const { get } = harness(new Map([['code-recorder.viewer.settings.v1', value]]));
    assert.equal(get('speed').value, '1');
    assert.equal(get('follow').checked, true);
  }
  const blocked = { get() { throw Error('denied'); }, set() { throw Error('denied'); } };
  const { get } = harness(blocked);
  assert.doesNotThrow(() => get('speed').onchange());
});

test('timeline times track playback position, speed changes, seeking, and restart', () => {
  const { get, context, tick } = harness();
  context.input = JSON.stringify({ format: 'code-recorder', version: 2,
    initial: [{ fileId: 'a', path: 'A.java', text: '' }],
    events: Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, type: 'edit', fileId: 'a',
      path: 'A.java', offset: i, removedText: '', insertedText: 'x' })) });
  vm.runInContext('load(input, "times")', context);
  assert.equal(get('elapsedTime').textContent, '진행 00:00');
  assert.equal(get('remainingTime').textContent, '남은 00:02');
  get('play').onclick();
  for (let i = 0; i < 10; i++) tick(100);
  assert.equal(get('elapsedTime').textContent, '진행 00:01');
  assert.equal(get('remainingTime').textContent, '남은 00:01');
  get('speed').value = '0.5'; get('speed').onchange();
  assert.equal(get('elapsedTime').textContent, '진행 00:02');
  assert.equal(get('remainingTime').textContent, '남은 00:02');
  get('progress').value = '20'; get('progress').oninput();
  assert.equal(get('elapsedTime').textContent, '진행 00:04');
  assert.equal(get('remainingTime').textContent, '남은 00:00');
  get('restart').onclick();
  assert.equal(get('elapsedTime').textContent, '진행 00:00');
});

test('automatic divider duration uses the selected 1–5 seconds independently of playback speed', () => {
  for (let seconds = 1; seconds <= 5; seconds++) {
    const { get, context, tick } = harness();
    context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
      { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
    ], events: [{ seq: 1, type: 'activate', fileId: 'b', path: 'B.java' }] });
    const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "divider")', context);
    assert.equal(get('transitionDuration').disabled, false);
    get('waitForContinue').checked = false; get('waitForContinue').onchange();
    assert.equal(get('transitionDuration').disabled, false);
    assert.equal(get('afterTransitionDelay').disabled, false);
    get('transitionDuration').value = String(seconds); get('transitionDuration').onchange();
    get('speed').value = '4'; get('speed').onchange();
    get('play').onclick(); tick(100); tick(100); tick(3000); tick(seconds * 1000 - 1);
    assert.equal(get('path').textContent, 'A.java');
    assert.equal(get('transition').hidden, false);
    tick(1);
    assert.equal(get('path').textContent, 'B.java');
    assert.equal(get('transition').hidden, true);
  }
});

test('before-transition delay keeps the old code visible for 1–10 seconds at any speed', () => {
  for (let seconds = 1; seconds <= 10; seconds++) {
    const { get, context, tick } = harness();
    context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
      { fileId: 'a', path: 'A.java', text: 'current code' }, { fileId: 'b', path: 'B.java', text: '' }
    ], events: [{ seq: 1, type: 'activate', fileId: 'b', path: 'B.java' }] });
    const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "before")', context);
    assert.equal(get('beforeTransitionDelay').value, '3');
    get('beforeTransitionDelay').value = String(seconds); get('beforeTransitionDelay').onchange();
    get('waitForContinue').checked = seconds % 2 === 0; get('waitForContinue').onchange();
    get('speed').value = '4'; get('speed').onchange();
    get('play').onclick(); tick(25); tick(25);
    tick(seconds * 1000 - 1);
    assert.equal(get('transition').hidden, true);
    assert.equal(get('path').textContent, 'A.java');
    assert.match(get('code').text(), /current code/);
    assert.equal(get('progress').attributes['aria-valuetext'], '1 / 3 순서');
    tick(1);
    assert.equal(get('transition').hidden, false);
    assert.equal(get('path').textContent, 'A.java');
    get('restart').onclick(); get('play').onclick(); tick(25); tick(25);
    get('restart').onclick(); tick(20000);
    assert.equal(get('transition').hidden, true);
    assert.equal(get('progress').attributes['aria-valuetext'], '0 / 3 순서');
  }
});

test('settings open on demand, show only the relevant timing, and close with Escape or outside click', () => {
  const { get, context } = harness();
  context.input = fs.readFileSync(path.join(__dirname, 'fixtures/navigation.coderec.json'), 'utf8');
  vm.runInContext('load(input, "settings")', context);
  assert.equal(get('settingsPanel').hidden, true);
  get('settingsToggle').onclick();
  assert.equal(get('settingsPanel').hidden, false);
  assert.equal(get('settingsToggle').attributes['aria-expanded'], 'true');
  assert.equal(get('afterTransitionDelayOption').hidden, false);
  assert.equal(get('transitionDurationOption').hidden, false);
  get('waitForContinue').checked = true; get('waitForContinue').onchange();
  assert.equal(get('afterTransitionDelayOption').hidden, false);
  assert.equal(get('transitionDurationOption').hidden, true);
  context.onkeydown({ key: 'Escape' });
  assert.equal(get('settingsPanel').hidden, true);
  assert.equal(get('settingsToggle').focused, true);
  get('settingsToggle').onclick();
  context.onclick({ target: get('settingsPanel') });
  assert.equal(get('settingsPanel').hidden, false);
  context.onclick({ target: get('play') });
  assert.equal(get('settingsPanel').hidden, true);
});

test('small countdowns describe each timed stage, but never manual or indefinite waits', () => {
  const { get, context, tick } = harness();
  context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
    { fileId: 'a', path: 'A.java', text: 'previous code' }, { fileId: 'b', path: 'B.java', text: '' }
  ], events: [
    { seq: 1, type: 'activate', fileId: 'b', path: 'B.java' },
    { seq: 2, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' }
  ] });
  const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "countdowns")', context);
  get('play').onclick(); tick(100); tick(100);
  assert.equal(get('playbackCountdown').hidden, false);
  assert.equal(get('countdownLabel').textContent, '전환 안내까지');
  assert.equal(get('countdownValue').textContent, '3초');
  tick(1000); assert.equal(get('countdownValue').textContent, '2초');
  tick(2000);
  assert.equal(get('countdownLabel').textContent, '다음 파일까지');
  assert.equal(get('countdownValue').textContent, '2초');
  tick(2000);
  assert.equal(get('playbackCountdown').hidden, false);
  assert.equal(get('countdownLabel').textContent, '코드 재생까지');
  assert.equal(get('countdownValue').textContent, '3초');
  get('restart').onclick();
  get('waitForContinue').checked = true; get('waitForContinue').onchange();
  get('play').onclick(); tick(100); tick(100); tick(3000); tick(60000);
  assert.equal(get('transition').hidden, false);
  assert.equal(get('playbackCountdown').hidden, true);
  get('continuePlayback').onclick();
  assert.equal(get('countdownLabel').textContent, '코드 재생까지');
  assert.equal(get('countdownValue').textContent, '3초');
  assert.equal(get('playbackCountdown').hidden, false);
  tick(2999); assert.doesNotMatch(get('code').text(), /hello/);
  tick(1); assert.match(get('code').text(), /hello/);
  assert.equal(get('playbackCountdown').hidden, true);
  get('restart').onclick(); get('play').onclick(); tick(100); tick(100);
  get('play').onclick(); assert.equal(get('playbackCountdown').hidden, true);
  tick(60000); assert.equal(get('playbackCountdown').hidden, true);
  get('stepMode').onclick(); get('nextStep').onclick(); tick(60000);
  assert.equal(get('transition').hidden, false);
  assert.equal(get('playbackCountdown').hidden, true);
});

test('half-second settings have the requested defaults, persist and run at exact boundaries', () => {
  const html = fs.readFileSync(path.join(__dirname, '../player/index.html'), 'utf8');
  for (const [id, maximum, defaultValue] of [['beforeTransitionDelay', 10, '2'], ['afterTransitionDelay', 10, '2'], ['transitionDuration', 5, '2']]) {
    const options = html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`))[1];
    assert.match(options, new RegExp(`<option value="${defaultValue.replace('.', '\\.')}" selected>`));
    const values = [...options.matchAll(/value="([^"]+)"/g)].map(m => Number(m[1]));
    assert.deepEqual(values, Array.from({ length: (maximum - 1) * 2 + 1 }, (_, i) => 1 + i / 2));
  }
  const storage = new Map(), { get, context, tick } = harness(storage);
  for (const id of ['beforeTransitionDelay', 'afterTransitionDelay', 'transitionDuration']) {
    get(id).value = '1.5'; get(id).onchange();
  }
  const restored = harness(storage);
  for (const id of ['beforeTransitionDelay', 'afterTransitionDelay', 'transitionDuration']) assert.equal(restored.get(id).value, '1.5');
  context.input = JSON.stringify({ format: 'code-recorder', version: 2, initial: [
    { fileId: 'a', path: 'A.java', text: '' }, { fileId: 'b', path: 'B.java', text: '' }
  ], events: [
    { seq: 1, type: 'activate', fileId: 'b', path: 'B.java' },
    { seq: 2, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' }
  ] });
  const fixture = JSON.parse(context.input);
  fixture.events.unshift({ type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: '// start\n' });
  if (!fixture.events.some(e => e.type === 'edit' && e.fileId === 'b'))
    fixture.events.push({ type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' });
  fixture.events.forEach((e, index) => e.seq = index + 1);
  context.input = JSON.stringify(fixture);
  vm.runInContext('load(input, "halves")', context);
  get('play').onclick(); tick(100); tick(100);
  assert.equal(get('countdownValue').textContent, '1.5초');
  tick(1499); assert.equal(get('transition').hidden, true);
  tick(1); assert.equal(get('transition').hidden, false);
  tick(1499); assert.equal(get('path').textContent, 'A.java');
  tick(1); assert.equal(get('path').textContent, 'B.java');
  tick(1499); assert.doesNotMatch(get('code').text(), /hello/);
  tick(1); assert.match(get('code').text(), /hello/);
});

test('view-only file visits disappear, while silent changes and later edits are preserved', () => {
  const { get, context, tick } = harness();
  const source = { format: 'code-recorder', version: 2, initial: [
    { fileId: 'pom', path: 'pom.xml', text: '<project/>' },
    { fileId: 'a', path: 'A.java', text: 'original' }
  ], events: [
    { type: 'activate', fileId: 'a', path: 'A.java' },
    { type: 'create', fileId: 'b', path: 'B.java', text: '' },
    { type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' },
    { type: 'activate', fileId: 'a', path: 'A.java' },
    { type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: 'original', insertedText: 'original' },
    { type: 'edit', fileId: 'a', path: 'A.java', offset: 8, removedText: '', insertedText: '\n  ' },
    { type: 'edit', fileId: 'b', path: 'B.java', offset: 5, removedText: '', insertedText: '!' },
    { type: 'activate', fileId: 'a', path: 'A.java' },
    { type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: 'original', insertedText: 'changed' },
    { type: 'end' }
  ] };
  source.events.forEach((event, i) => event.seq = i + 1);
  context.input = JSON.stringify(source);
  vm.runInContext('load(input, "silent visits")', context);
  assert.equal(get('path').textContent, 'B.java');
  assert.equal(get('transition').hidden, true);
  get('play').onclick(); tick(100);
  assert.match(get('code').text(), /hello/);
  assert.equal(get('path').textContent, 'B.java');
  assert.equal(get('transition').hidden, true);
  tick(100); assert.match(get('code').text(), /hello!/);
  tick(100); tick(3000);
  assert.equal(get('transition').hidden, false, 'a later real edit still gets a file transition');
  assert.equal(get('transitionTitle').textContent, 'A.java');
  const api = require('../player/replay.js');
  const prepared = api.preparePlayback(source);
  const original = new api.Replay(source).seekEvent(source.events.length);
  const replay = new api.Replay(prepared).seekEvent(prepared.events.length);
  assert.deepEqual([...replay.files], [...original.files]);
  replay.seekEvent(0);
  assert.equal(replay.active, 'b');
  assert.equal(replay.files.get('b').text, '');
  replay.seekEvent(prepared.events.length);
  assert.deepEqual([...replay.files], [...original.files]);
  assert.equal(api.buildStudySteps(prepared).filter(step => step.type === 'transition').length, 1);
  assert.equal(source.events[0].silent, undefined, 'the recording itself is unchanged');
});

test('eight playback speeds preserve normal as default and restore every new speed', () => {
  const html = fs.readFileSync(path.join(__dirname, '../player/index.html'), 'utf8');
  const options = html.match(/<select id="speed"[^>]*>(.*?)<\/select>/)[1];
  assert.deepEqual([...options.matchAll(/value="([^"]+)"/g)].map(m => m[1]),
    ['0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4']);
  assert.match(options, /value="1" selected>보통/);
  for (const speed of ['0.25', '0.75', '1.5', '3']) {
    const storage = new Map(), first = harness(storage);
    first.get('speed').value = speed; first.get('speed').onchange();
    assert.equal(harness(storage).get('speed').value, speed);
  }
});


test('timeline starts at zero after skipped setup, seeks relative to playback, and resets on reload', () => {
  const { get, context, tick } = harness();
  const source = { format: 'code-recorder', version: 2, initial: [
    { fileId: 'a', path: 'A.java', text: 'unchanged' }
  ], events: [
    { seq: 1, type: 'activate', fileId: 'a', path: 'A.java' },
    { seq: 2, type: 'create', fileId: 'b', path: 'B.java', text: '' },
    { seq: 3, type: 'edit', fileId: 'b', path: 'B.java', offset: 0, removedText: '', insertedText: 'hello' },
    { seq: 4, type: 'end' }
  ] };
  context.input = JSON.stringify(source);
  vm.runInContext('load(input, "offset")', context);
  assert.equal(get('progress').value, 0);
  assert.equal(get('progress').max, 2);
  assert.match(get('elapsedTime').textContent, /00:00$/);
  get('progress').value = '1'; get('progress').oninput();
  assert.match(get('code').text(), /hello/);
  get('progress').value = '2'; get('progress').oninput();
  assert.equal(get('progress').value, get('progress').max);
  get('progress').value = '0'; get('progress').oninput();
  assert.equal(get('progress').value, 0);
  assert.doesNotMatch(get('code').text(), /hello/);
  get('play').onclick(); tick(100);
  assert.match(get('code').text(), /hello/);
  get('restart').onclick();
  assert.equal(get('progress').value, 0);
  get('stepMode').onclick();
  assert.equal(get('progress').value, 0);
  get('nextStep').onclick();
  assert.ok(get('progress').value > 0);
  get('previousStep').onclick();
  assert.equal(get('progress').value, 0);
  get('autoMode').onclick();
  context.input = JSON.stringify({ ...source, events: [source.events[0], { seq: 2, type: 'end' }] });
  vm.runInContext('load(input, "no visible changes")', context);
  assert.equal(get('progress').value, 0);
  assert.equal(get('progress').disabled, true);
  context.input = JSON.stringify({ ...source, events: [
    { seq: 1, type: 'edit', fileId: 'a', path: 'A.java', offset: 0, removedText: '', insertedText: 'new' },
    { seq: 2, type: 'end' }
  ] });
  vm.runInContext('load(input, "no skipped setup")', context);
  assert.equal(get('progress').value, 0);
  assert.equal(get('progress').max, 2);
  assert.equal(get('progress').disabled, false);
});


test('timeline uses one color per file including its activation, and hides invisible visits', () => {
  const {get, context} = harness();
  context.input = JSON.stringify({format:'code-recorder',version:2,initial:[
    {fileId:'a',path:'A.java',text:''},{fileId:'b',path:'B.java',text:''},{fileId:'c',path:'Hidden.java',text:''}
  ],events:[
    {seq:1,type:'edit',fileId:'a',path:'A.java',offset:0,removedText:'',insertedText:'a'},
    {seq:2,type:'activate',fileId:'c',path:'Hidden.java'},
    {seq:3,type:'activate',fileId:'b',path:'B.java'},
    {seq:4,type:'edit',fileId:'b',path:'B.java',offset:0,removedText:'',insertedText:'b'},
    {seq:5,type:'activate',fileId:'a',path:'A.java'},
    {seq:6,type:'edit',fileId:'a',path:'A.java',offset:1,removedText:'',insertedText:'z'},
    {seq:7,type:'end'}
  ]});
  vm.runInContext('load(input, "colors")',context);
  const segments=get('timelineSegments').children;
  assert.deepEqual(segments.map(s=>s.textContent),['A.java','B.java','A.java']);
  const color=s=>s.attributes.style.split('background:')[1];
  assert.equal(color(segments[0]),color(segments[2]));
  assert.notEqual(color(segments[0]),color(segments[1]));
  assert.ok(segments.every(s=>s.className==='timeline-segment'));
  get('progress').getBoundingClientRect=()=>({left:0,width:716});
  get('progress').onpointermove({clientX:258});
  assert.equal(get('progress').title,'B.java');
  get('progress').value='4'; get('progress').oninput();
  assert.equal(get('path').textContent,'B.java');
  get('restart').onclick(); assert.equal(get('progress').value,0);
});
