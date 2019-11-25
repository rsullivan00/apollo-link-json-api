/**
 * Adapted from apollo-link-state/utils.ts
 */
import { DocumentNode, DirectiveNode } from 'graphql';

import { checkDocument, removeDirectivesFromDocument } from 'apollo-utilities';

const connectionRemoveConfig = {
  test: (directive: DirectiveNode) => directive.name.value === 'jsonapi',
  remove: true,
};

const removed = new Map();
export function removeRestSetsFromDocument(query: DocumentNode): DocumentNode {
  const cached = removed.get(query);
  if (cached) return cached;

  checkDocument(query);

  const docClone = removeDirectivesFromDocument(
    [connectionRemoveConfig],
    query,
  );

  removed.set(query, docClone);
  return docClone;
}

export const mapObject = (obj, fn) =>
  Object.entries(obj)
    .map(fn)
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

export const mapObjectValues = (obj, fn) =>
  mapObject(obj, ([k, v]) => [k, fn(v)]);

export const identity = v => v;
