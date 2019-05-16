import { pascalize } from 'humps';
import { mapObject } from './utils';

const typenameResource = resource => ({
  __typename: pascalize(resource.type),
  ...resource,
});

const flattenResource = ({
  attributes,
  relationships,
  links,
  ...restResource
}) => {
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

const findResource = ({ id, type }, resources) => {
  const result = resources.find(
    ({ id: resourceId, type: resourceType }) =>
      id === resourceId && type === resourceType,
  );
  console.log('Found resource', result);
  return result;
};

const _denormalizeRelationships = (data, allResources) => {
  if (!data || !data.relationships || data.__relationships_denormalizing) {
    return data;
  }
  data.__relationships_denormalizing = true;

  console.log(data);
  console.log(allResources);

  const relationships = mapObject(
    data.relationships,
    ([relationshipName, related]) => {
      if (!related.data) {
        return [relationshipName, null];
      }
      if (Array.isArray(related.data)) {
        console.log(related.data);
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

const denormalizeRelationships = (data, { included }) => {
  if (!included) {
    return data;
  }
  return _denormalizeRelationships(data, [data, ...included]);
};

const typenameIncludedResources = ({ included, ...rest }) => {
  if (!included) {
    return rest;
  }
  return { ...rest, included: included.map(typenameResource) };
};

const applyToData = fn => ({ data, ...rest }) => {
  if (Array.isArray(data)) {
    return { data: data.map(obj => fn(obj, rest)), ...rest };
  }
  return { data: fn(data, rest), ...rest };
};

const jsonapiResponseTransformer = async response =>
  response
    .json()
    .then(typenameIncludedResources)
    .then(applyToData(typenameResource))
    .then(applyToData(denormalizeRelationships))
    .then(applyToData(flattenResource))
    .then(({ data, included }) => data);

export default jsonapiResponseTransformer;
