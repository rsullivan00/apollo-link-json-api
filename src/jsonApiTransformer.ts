import { mapObject, identity } from './utils';
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

  jsonapiFullResponse?: JsonApiBody;
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
      return [
        relationshipName,
        applyToData(item =>
          _denormalizeRelationships(
            findResource(item, allResources) || item,
            allResources,
          ),
        )(related).data,
      ];
    },
  );
  return { ...data, relationships };
};

const denormalizeRelationships = (data: Resource, { included = [] }) => {
  return _denormalizeRelationships(data, [data, ...included]);
};

const _denormalizeJsonapiRelationships = (
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
      return [
        relationshipName,
        applyToData(item =>
          _denormalizeJsonapiRelationships(
            findResource(item, allResources) || item,
            allResources,
          ),
        )(related),
      ];
    },
  );
  return { ...data, relationships };
};

const denormalizeJsonapiRelationships = (data: Resource, { included = [] }) => {
  return _denormalizeJsonapiRelationships(data, [data, ...included]);
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

const applyToJsonapiFullResponse = fn => ({
  jsonapiFullResponse,
  ...rest
}: JsonApiBody) =>
  jsonapiFullResponse
    ? { jsonapiFullResponse: fn(jsonapiFullResponse), ...rest }
    : (rest as JsonApiBody);

const applyNormalizer = (normalizer: JsonApiLink.TypeNameNormalizer) => (
  resource: Resource,
) => ({
  __typename: normalizer(resource.type),
  ...resource,
});

const typeFor = (data: Resource | Array<Resource>) =>
  Array.isArray(data) ? data[0] && data[0].type : data.type;

const typenameNamespacer = (prefix, normalizer) => {
  const resourceTypenameNamespacer = ({
    attributes,
    relationships,
    meta,
    links,
    ...resource
  }: Resource) => {
    const __typename = normalizer(`${prefix}${resource.type}`);
    return {
      ...resource,
      __typename,
      attributes: attributes && {
        ...attributes,
        __typename: normalizer(`${__typename}_attributes`),
      },
      relationships: relationships && {
        ...mapObject(relationships, ([name, related]) => {
          if (!related || !related.data) {
            return [name, related];
          }
          return [name, applyToData(resourceTypenameNamespacer)(related)];
        }),
        __typename: normalizer(`${__typename}_relationships`),
      },
      meta: meta && {
        ...meta,
        __typename: normalizer(`${__typename}_meta`),
      },
      links: links && {
        ...links,
        __typename: normalizer(`${__typename}_links`),
      },
    };
  };

  const bodyTypenameNamespacer = body => {
    const type = typeFor(body.data) || 'unknown';
    return {
      data:
        body.data &&
        (Array.isArray(body.data)
          ? body.data.map(resourceTypenameNamespacer)
          : resourceTypenameNamespacer(body.data)),
      meta: body.meta && {
        ...body.meta,
        __typename: normalizer(`${prefix}${type}_body_meta`),
      },
      links: body.links && {
        ...body.links,
        __typename: normalizer(`${prefix}${type}_body_links`),
      },
      included: body.included
        ? body.included.map(resourceTypenameNamespacer)
        : body.included,
      __typename: normalizer(`${prefix}${type}_body`),
    };
  };

  return bodyTypenameNamespacer;
};

const preserveBody = normalizer => async (body: JsonApiBody) => {
  return {
    ...body,
    jsonapiFullResponse: typenameNamespacer('jsonapiFullResponse_', normalizer)(
      body,
    ),
  } as JsonApiBody;
};

const jsonapiResponseTransformer = async (
  response: Response,
  typeNameNormalizer: JsonApiLink.TypeNameNormalizer,
  includeJsonapi: boolean,
) =>
  response
    .json()
    .then(applyToIncluded(applyNormalizer(typeNameNormalizer)))
    .then(applyToData(applyNormalizer(typeNameNormalizer)))
    .then(includeJsonapi ? preserveBody(typeNameNormalizer) : identity)
    .then(applyToData(denormalizeRelationships))
    .then(applyToData(flattenResource))
    .then(
      applyToJsonapiFullResponse(
        applyToIncluded(denormalizeJsonapiRelationships),
      ),
    )
    .then(
      applyToJsonapiFullResponse(applyToData(denormalizeJsonapiRelationships)),
    )
    .then(({ data, jsonapiFullResponse }) =>
      includeJsonapi ? { graphql: data, jsonapi: jsonapiFullResponse } : data,
    );

export default jsonapiResponseTransformer;
