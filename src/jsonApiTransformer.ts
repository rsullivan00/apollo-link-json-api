import { mapObject, pipe } from './utils';
import { JsonApiLink } from './jsonApiLink';
import { JsonApiBody, Resource, ResourceIdentifier } from './types';

const flattenResource = ({
  attributes,
  relationships,
  links,
  ...restResource
}: Resource) => {
  if (!relationships) {
    return {
      ...restResource,
      ...attributes,
    };
  }
  const flattenedRelationships = mapObject(relationships, ([k, related]) => {
    if (!related) {
      return [k, related];
    }
    if (Array.isArray(related)) {
      return [k, related.map(flattenResource)];
    }
    return [k, flattenResource(related)];
  });
  return {
    ...restResource,
    ...attributes,
    ...flattenedRelationships,
  };
};

const findResource = (
  { id, type }: ResourceIdentifier,
  resources: Array<Resource>,
) =>
  resources.find(
    ({ id: resourceId, type: resourceType }) =>
      id === resourceId && type === resourceType,
  );

const _denormalizeRelationships = (
  data: Resource,
  allResources: Array<Resource>,
) => {
  if (!data || !data.relationships || data.__relationships_denormalizing) {
    return data;
  }
  data.__relationships_denormalizing = true;

  const relationships = mapObject(
    data.relationships,
    ([relationshipName, related]) => {
      if (!related.data) {
        return [relationshipName, null];
      }
      if (Array.isArray(related.data)) {
        return [
          relationshipName,
          related.data.map(item =>
            _denormalizeRelationships(
              findResource(item, allResources) || item,
              allResources,
            ),
          ),
        ];
      }
      return [
        relationshipName,
        _denormalizeRelationships(
          findResource(related.data, allResources) || related.data,
          allResources,
        ),
      ];
    },
  );
  return { ...data, relationships };
};

const denormalizeRelationships = (data: Resource, { included = [] }) => {
  return _denormalizeRelationships(data, [data, ...included]);
};

const applyToData = fn => ({ data, ...rest }: JsonApiBody) => {
  if (Array.isArray(data)) {
    return { data: data.map(obj => fn(obj, rest)), ...rest };
  }
  return { data: fn(data, rest), ...rest };
};

const applyToIncluded = fn => ({ included, ...rest }: JsonApiBody) => {
  if (!included) {
    return rest;
  }
  return { included: included.map(obj => fn(obj, rest)), ...rest };
};

const applyNormalizer = (normalizer: JsonApiLink.TypeNameNormalizer) => (
  resource: Resource,
) => ({
  __typename: normalizer(resource.type),
  ...resource,
});

// TODO: Can we remove the normalizer application from here?
const jsonapiResponseTransformer = (
  body: JsonApiBody,
  typeNameNormalizer: JsonApiLink.TypeNameNormalizer,
): object =>
  pipe(
    applyToIncluded(applyNormalizer(typeNameNormalizer)),
    applyToData(applyNormalizer(typeNameNormalizer)),
    applyToData(denormalizeRelationships),
    applyToData(flattenResource),
    ({ data }) => data,
  )(body);

export default jsonapiResponseTransformer;
