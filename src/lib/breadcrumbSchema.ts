// Helper to build a BreadcrumbList JSON-LD object.
// Pass an ordered list of crumbs; the first should be Home.

const BASE_URL = 'https://haultrackerpro.com';

export interface BreadcrumbCrumb {
  name: string;
  path: string; // e.g. "/features"
}

export function buildBreadcrumbSchema(crumbs: BreadcrumbCrumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${BASE_URL}${c.path}`,
    })),
  };
}
