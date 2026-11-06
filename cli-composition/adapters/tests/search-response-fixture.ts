export function keywordResponse(): Response {
  return Response.json({ resultsMap: { dashboards: [{ data: { id: 'MD_OIL', title: 'Oil volatility', type: 'Dashboard', children: [], alias: 'oil-volatility', url: '/s/marketview/dashboards/MD_OIL' } }] } });
}

export function emptySearchResponse(): Response {
  return Response.json({ resultsMap: {} });
}
