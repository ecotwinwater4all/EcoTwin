// The editable chart document is embedded in chart.html as JSON. Keeping data
// separate from behavior makes Save replace one explicit block and gives the
// file format a schema version without sacrificing a portable document file.
var CHART_DOCUMENT_ELEMENT_ID = 'chart-document';
var CHART_DOCUMENT_SCHEMA_VERSION = 1;

function cloneDocumentValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readEmbeddedChartDocument() {
  var element = document.getElementById(CHART_DOCUMENT_ELEMENT_ID);
  if (!element) throw new Error('Missing embedded chart document');
  var parsed = JSON.parse(element.textContent);
  if (parsed.schemaVersion !== CHART_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported chart document schema: ' + parsed.schemaVersion);
  }
  return parsed;
}

function serializeChartDocument(documentState) {
  // Escaping "<" prevents user-authored text from closing the script element.
  return JSON.stringify(documentState, null, 2).replace(/</g, '\\u003c');
}

function replaceEmbeddedChartDocument(html, documentState) {
  var pattern = /<script id="chart-document" type="application\/json">[\s\S]*?<\/script>/g;
  var matches = html.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error('Expected exactly one embedded chart document block');
  }
  return html.replace(
    pattern,
    '<script id="chart-document" type="application/json">\n' +
      serializeChartDocument(documentState) + '\n</script>'
  );
}

var INITIAL_CHART_DOCUMENT = readEmbeddedChartDocument();
var DATA = cloneDocumentValue(INITIAL_CHART_DOCUMENT.data || {});
var DEFAULT_CANVAS_SIZE = cloneDocumentValue(INITIAL_CHART_DOCUMENT.canvas || { w: 1100, h: 1100, manual: false, scale: 1 });
var DEFAULT_POSITIONS = cloneDocumentValue(INITIAL_CHART_DOCUMENT.positions || {});
var DEFAULT_LABEL_POSITIONS = cloneDocumentValue(INITIAL_CHART_DOCUMENT.labelPositions || {});
var DEFAULT_DELETED_NODES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.deletedNodes || []);
var DEFAULT_CUSTOM_NODES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.customNodes || {});
var DEFAULT_TEXT_OVERRIDES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.textOverrides || {});
var DEFAULT_STYLE_OVERRIDES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.styleOverrides || {});
var DEFAULT_SIDEBAR_OVERRIDES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.sidebar || {});
var DEFAULT_ARROWS = cloneDocumentValue(INITIAL_CHART_DOCUMENT.arrows || []);
var DEFAULT_FONT_SIZES = cloneDocumentValue(INITIAL_CHART_DOCUMENT.fontSizes || { label: 20, ntitle: 20, nsub: 20, badge: 20 });
var DEFAULT_LEGEND = cloneDocumentValue(INITIAL_CHART_DOCUMENT.legend || {});
var DEFAULT_FOOTER_TEXT = typeof INITIAL_CHART_DOCUMENT.footer === 'string' ? INITIAL_CHART_DOCUMENT.footer : null;
var DEFAULT_SPLIT_STATE = cloneDocumentValue(INITIAL_CHART_DOCUMENT.split || { w: 280 });
