// Sends www.tnelection.org/<path> to tnelection.org/<path>, keeping the path and query.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'tnelection.org';
    return Response.redirect(url.href, 301);
  },
};
