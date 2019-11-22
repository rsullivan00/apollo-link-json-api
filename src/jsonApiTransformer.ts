import { mapObject } from './utils';
import { JsonApiLink } from './jsonApiLink';

interface ResourceIdentifier {
  id: string;
  type: string;
}

type RelationshipData = ResourceIdentifier | Array<ResourceIdentifier>;

interface LinkObject {
  href?: string;
  meta?: object;
}

type Link = string | LinkObject;

interface Links {
  [key: string]: Link;
}

interface RelationshipInfo {
  links?: Links;
  data?: RelationshipData;
  meta?: object;
}

interface Relationships {
  [relationshipName: string]: RelationshipInfo;
}

interface Resource {
  id: string;
  type: string;
  attributes?: object;
  links?: Links;
  meta?: object;
  relationships?: Relationships;
  __relationships_denormalizing?: boolean;
}

interface JsonApiBody {
  data?: Resource | Array<Resource>;
  included?: Array<Resource> | undefined;
  meta?: object;
  errors?: Array<Error>;
  links?: Links;
  jsonapi?: object;
}

const findResource = (
  { id, type }: ResourceIdentifier,
  resources: Array<Resource>,
) =>
  resources.find(
    ({ id: resourceId, type: resourceType }) =>
      id === resourceId && type === resourceType,
  );

// TODO: The `findResource` lookups could be sped up by using a map instead
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
        return [relationshipName, related];
      }
      if (Array.isArray(related.data)) {
        return [
          relationshipName,
          {
            ...related,
            data: related.data.map(item =>
              _denormalizeRelationships(
                findResource(item, allResources) || item,
                allResources,
              ),
            ),
          },
        ];
      }
      return [
        relationshipName,
        {
          ...related,
          data: _denormalizeRelationships(
            findResource(related.data, allResources) || related.data,
            allResources,
          ),
        },
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

const jsonapiResponseTransformer = async (
  response: Response,
  typeNameNormalizer: JsonApiLink.TypeNameNormalizer,
) =>
  response
    .json()
    .then(applyToIncluded(applyNormalizer(typeNameNormalizer)))
    .then(applyToData(applyNormalizer(typeNameNormalizer)))
    .then(applyToData(denormalizeRelationships));

export default jsonapiResponseTransformer;
