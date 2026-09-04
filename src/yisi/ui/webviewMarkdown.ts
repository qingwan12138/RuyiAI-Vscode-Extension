// Webview-side minimal Markdown renderer source.
//
// Deliberately kept OUT of the main HTML template literal: inside that template,
// single backslashes in regexes (e.g. `\s`) are swallowed, producing invalid JS
// that kills the whole webview. Here `String.raw` preserves them verbatim, and
// backticks are avoided via `String.fromCharCode(96)` so nothing breaks the
// template delimiters. The resulting string is interpolated into the webview
// <script> by chatViewHtml.

export const MARKDOWN_RENDERER_SOURCE = String.raw`
function mdEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
var MD_BACKTICK = String.fromCharCode(96);
var MD_TRIPLE = MD_BACKTICK + MD_BACKTICK + MD_BACKTICK;
function mdInlineText(value) {
  var codeRe = new RegExp(MD_BACKTICK + '([^' + MD_BACKTICK + ']+)' + MD_BACKTICK, 'g');
  value = value.replace(codeRe, '<code class="md-icode">$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return value;
}
function mdSplitRow(cells) {
  return cells.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (cell) { return cell.trim(); });
}
function safeMarkdown(source) {
  var lines = mdEscape(source || '').split('\n');
  var out = [];
  var i = 0;
  function isTableSeparator(line) { return /^[\s:|–-]+$/.test(line) && line.indexOf('-') >= 0; }
  function isListBullet(line) { return /^\s*[-*+]\s+/.test(line); }
  function isOrderedList(line) { return /^\s*\d+\.\s+/.test(line); }
  function isHeading(line) { return /^#{1,6}\s/.test(line); }
  while (i < lines.length) {
    var line = lines[i];
    if (line.indexOf(MD_TRIPLE) === 0) {
      var buffer = [];
      var j = i + 1;
      while (j < lines.length && lines[j].indexOf(MD_TRIPLE) !== 0) { buffer.push(lines[j]); j += 1; }
      out.push('<pre class="md-code"><code>' + buffer.join('\n') + '</code></pre>');
      i = j + 1;
      continue;
    }
    if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      var header = mdSplitRow(lines[i]);
      var body = [];
      var k = i + 2;
      while (k < lines.length && lines[k].indexOf('|') >= 0 && !isTableSeparator(lines[k])) { body.push(mdSplitRow(lines[k])); k += 1; }
      var headHtml = header.map(function (cell) { return '<th>' + mdInlineText(cell) + '</th>'; }).join('');
      var rowsHtml = body.map(function (row) { return '<tr>' + row.map(function (cell) { return '<td>' + mdInlineText(cell) + '</td>'; }).join('') + '</tr>'; }).join('');
      out.push('<div class="md-table-wrap"><table><thead><tr>' + headHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>');
      i = k;
      continue;
    }
    if (isHeading(line)) {
      var level = line.match(/^#+/)[0].length;
      out.push('<h' + level + '>' + mdInlineText(line.replace(/^#+\s*/, '')) + '</h' + level + '>');
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      var quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      out.push('<blockquote class="md-quote">' + mdInlineText(quote.join(' ')) + '</blockquote>');
      continue;
    }
    if (isListBullet(line)) {
      var bullets = [];
      while (i < lines.length && isListBullet(lines[i])) { bullets.push(mdInlineText(lines[i].replace(/^\s*[-*+]\s+/, ''))); i += 1; }
      out.push('<ul>' + bullets.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>');
      continue;
    }
    if (isOrderedList(line)) {
      var ordered = [];
      while (i < lines.length && isOrderedList(lines[i])) { ordered.push(mdInlineText(lines[i].replace(/^\s*\d+\.\s+/, ''))); i += 1; }
      out.push('<ol>' + ordered.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ol>');
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) { out.push('<hr class="md-hr">'); i += 1; continue; }
    if (line.trim() === '') { i += 1; continue; }
    var para = [];
    while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf(MD_TRIPLE) !== 0
      && !isHeading(lines[i]) && !/^>\s?/.test(lines[i]) && !isListBullet(lines[i])
      && !isOrderedList(lines[i]) && !/^\s*---+\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    out.push('<p>' + para.map(function (item) { return mdInlineText(item); }).join('<br>') + '</p>');
  }
  return out.join('');
}
`;
