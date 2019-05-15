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

const findResource = ({ id, type }, resources) =>
  resources.find(
    ({ id: resourceId, type: resourceType }) =>
      id === resourceId && type === resourceType,
  );

const denormalizeRelationships = (data, rest) => {
  if (!rest.included || !data.relationships) {
    return data;
  }
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
            denormalizeRelationships(findResource(item, rest.included), rest),
          ),
        ];
      }
      return [
        relationshipName,
        denormalizeRelationships(
          findResource(related.data, rest.included),
          rest,
        ),
      ];
    },
  );
  return { ...data, relationships };
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
    .then(({ data, included }) => data)
    // TODO Remove this debugging code
    // .then(r => console.log(r) || r)
    .catch(e => console.error(e));

export default jsonapiResponseTransformer;
