function json(statusCode, body) {
    return {
          statusCode,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(body),
        };
  }

function parseBody(event) {
    try {
          return event.body ? JSON.parse(event.body) : {};
        } catch (e) {
          return {};
        }
  }

module.exports = { json, parseBody };
