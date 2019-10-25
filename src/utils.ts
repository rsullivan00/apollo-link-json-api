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

export const identity = v => v;

export const pipe = (f1: Function, ...fns: Function[]): Function =>
  fns.reduce((prev, next) => val => next(prev(val)), f1);

export const compose = (f1: Function, ...fns: Function[]): Function =>
  fns.reduce((prev, next) => val => prev(next(val)), f1);
