import { mapObject } from './utils';
import { JsonApiLink } from './jsonApiLink';

interface ResourceIdentifier {
  id: string;
  type: string;
}

type RelationshipData = ResourceIdentifier | Array<ResourceIdentifier>;

interface RelationshipInfo {
  links: object;
  data?: RelationshipData;
}

interface Relationships {
  [relationshipName: string]: RelationshipInfo;
}

interface Resource {
  id: string;
  type: string;
  links: object;
  attributes: object;
  relationships?: Relationships;
  __relationships_denormalizing?: boolean;
}

interface JsonApiBody {
  data: Resource | Array<Resource>;
  included?: Array<Resource> | undefined;
}

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
) => {
  const result = resources.find(
    ({ id: resourceId, type: resourceType }) =>
      id === resourceId && type === resourceType,
  );
  return result;
};

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
              findResource(item, allResources),
              allResources,
            ),
          ),
        ];
      }
      return [
        relationshipName,
        _denormalizeRelationships(
          findResource(related.data, allResources),
          allResources,
        ),
      ];
    },
  );
  return { ...data, relationships };
};

const denormalizeRelationships = (data: Resource, { included }) => {
  if (!included) {
    return data;
  }
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

const jsonapiResponseTransformer = async (
  response: Response,
  typeNameNormalizer: JsonApiLink.TypeNameNormalizer,
) =>
  response
    .json()
    .then(applyToIncluded(applyNormalizer(typeNameNormalizer)))
    .then(applyToData(applyNormalizer(typeNameNormalizer)))
    .then(applyToData(denormalizeRelationships))
    .then(applyToData(flattenResource))
    .then(({ data, included }) => data);

export default jsonapiResponseTransformer;
