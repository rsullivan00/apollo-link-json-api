import { mapObjectValues, identity } from './utils';
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

  __jsonapi_full_response?: JsonApiBody;
  __typename?: string;
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
  const flattenedRelationships = mapObjectValues(
    relationships,
    related =>
      related && related.data && applyToData(flattenResource)(related).data,
  );
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

  const relationships = mapObjectValues(
    data.relationships,
    related =>
      related &&
      related.data &&
      applyToData(item =>
        _denormalizeRelationships(
          findResource(item, allResources) || item,
          allResources,
        ),
      )(related),
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

const applyToJsonapiFullResponse = fn => ({
  __jsonapi_full_response,
  ...rest
}: JsonApiBody) =>
  __jsonapi_full_response
    ? { __jsonapi_full_response: fn(__jsonapi_full_response), ...rest }
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
        ...mapObjectValues(
          relationships,
          related =>
            related &&
            related.data &&
            applyToData(resourceTypenameNamespacer)(related),
        ),
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
  const __jsonapi_full_response = typenameNamespacer(
    'jsonapi_full_response_',
    normalizer,
  )(body);
  return {
    ...body,
    __typename: normalizer(`${__jsonapi_full_response.__typename}_wrapper`),
    __jsonapi_full_response,
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
    .then(applyToJsonapiFullResponse(applyToIncluded(denormalizeRelationships)))
    .then(applyToJsonapiFullResponse(applyToData(denormalizeRelationships)))
    .then(({ data, __jsonapi_full_response, __typename }) =>
      includeJsonapi
        ? { graphql: data, jsonapi: __jsonapi_full_response, __typename }
        : data,
    );

export default jsonapiResponseTransformer;
