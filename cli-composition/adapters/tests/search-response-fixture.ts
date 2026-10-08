export function keywordResponse(): Response {
  return Response.json({ resultsMap: { dashboards: [{ data: { id: 'MD_OIL', title: 'Oil volatility', type: 'Dashboard', children: [], alias: 'oil-volatility' } }] } });
}

export function emptySearchResponse(): Response {
  return Response.json({ resultsMap: {} });
}
