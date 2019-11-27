import {
  OperationTypeNode,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  // Query Nodes
  DirectiveNode,
  FieldNode,
  SelectionSetNode,
} from 'graphql';
import {
  ApolloLink,
  Observable,
  Operation,
  NextLink,
  FetchResult,
} from 'apollo-link';
import {
  hasDirectives,
  getMainDefinition,
  getFragmentDefinitions,
  createFragmentMap,
  addTypenameToDocument,
  FragmentMap,
  isField,
  isInlineFragment,
  resultKeyNameFromField,
} from 'apollo-utilities';
import jsonApiTransformer from './jsonApiTransformer';
import global from './global';

import { graphql } from 'graphql-anywhere/lib/async';
import { Resolver, ExecInfo } from 'graphql-anywhere';

import * as qs from 'qs';
import { removeRestSetsFromDocument, identity } from './utils';

export namespace JsonApiLink {
  export type URI = string;

  export type Endpoint = string;

  export interface EndpointOptions {
    uri: Endpoint;
  }

  export interface Endpoints {
    [endpointKey: string]: Endpoint | EndpointOptions;
  }

  export type Header = string;
  export interface HeadersHash {
    [headerKey: string]: Header;
  }
  export type InitializationHeaders = HeadersHash | Headers | string[][];

  export type HeadersMergePolicy = (...headerGroups: Headers[]) => Headers;

  export interface TypeNameNormalizer {
    (typeName: string): string;
  }

  export interface FieldNameNormalizer {
    (fieldName: string, keypath?: string[]): string;
  }

  export interface SerializedBody {
    body: any;
    headers: InitializationHeaders;
  }

  export interface Serializer {
    (data: any, headers: Headers): SerializedBody;
  }

  export interface Serializers {
    [bodySerializer: string]: Serializer;
  }

  export type CustomFetch = (
    request: RequestInfo,
    init: RequestInit,
  ) => Promise<Response>;

  export interface JsonApiLinkHelperProps {
    /** Arguments passed in via normal graphql parameters */
    args: { [key: string]: any };
    /** Arguments added via @export(as: ) directives */
    exportVariables: { [key: string]: any };
    /** Arguments passed directly to @jsonapi(params: ) */
    // params: { [key: string]: any };
    /** Apollo Context */
    context: { [key: string]: any };
    /** All arguments passed to the `@jsonapi(...)` directive */
    '@jsonapi': { [key: string]: any };
  }
  export interface PathBuilderProps extends JsonApiLinkHelperProps {
    replacer: (opts: JsonApiLinkHelperProps) => string;
  }

  /**
   * Used for any Error from the server when requests:
   * - terminate with HTTP Status >= 300
   * - and the response contains no data or errors
   */
  export type ServerError = Error & {
    response: Response;
    result: any;
    statusCode: number;
  };

  export type Options = {
    /**
     * The URI to use when fetching operations.
     *
     * Optional if endpoints provides a default.
     */
    uri?: URI;

    /**
     * A root endpoint (uri) to apply paths to or a map of endpoints.
     */
    endpoints?: Endpoints;

    /**
     * An object representing values to be sent as headers on the request.
     */
    headers?: InitializationHeaders;

    /**
     * A function that takes the JSON API `type` and converts it to a GraphQL compliant `__typename`
     */
    typeNameNormalizer?: TypeNameNormalizer;

    /**
     * A function that takes the response field name and converts it into a GraphQL compliant name
     *
     */
    fieldNameNormalizer?: FieldNameNormalizer;

    /**
     * A function that takes a GraphQL-compliant field name and converts it back into an endpoint-specific name
     * Can be overridden at the mutation-call-site (in the rest-directive).
     */
    fieldNameDenormalizer?: FieldNameNormalizer;

    /**
     * The credentials policy you want to use for the fetch call.
     */
    credentials?: RequestCredentials;

    /**
     * Use a custom fetch to handle REST calls.
     */
    customFetch?: CustomFetch;

    /**
     * Add serializers that will serialize the body before it is emitted and will pass on
     * headers to update the request.
     */
    bodySerializers?: Serializers;

    /**
     * Set the default serializer for the link
     * @default JSON serialization
     */
    defaultSerializer?: Serializer;
  };

  /** @jsonapi(...) Directive Options */
  export interface DirectiveOptions {
    /**
     * What HTTP method to use.
     * @default `GET`
     */
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** What GraphQL type to name the response */
    type?: string;
    /**
     * What path (including query) to use
     * - @optional if you provide @see DirectiveOptions.pathBuilder
     */
    path?: string;
    /**
     * What endpoint to select from the map of endpoints available to this link.
     * @default `JsonApiLink.endpoints[DEFAULT_ENDPOINT_KEY]`
     */
    endpoint?: string;
    /**
     * Function that constructs a request path out of the Environmental
     *  state when processing this @jsonapi(...) call.
     *
     * - @optional if you provide: @see DirectiveOptions.path
     * - **note**: providing this function means it's your responsibility to call
     *             encodeURIComponent directly if needed!
     *
     * Warning: This is an Advanced API and we are looking for syntactic & ergonomics feedback.
     */
    pathBuilder?: (props: PathBuilderProps) => string;
    /**
     * Optional method that constructs a RequestBody out of the Environmental state
     * when processing this @jsonapi(...) call.
     * @default function that extracts the bodyKey from the args.
     *
     * Warning: This is an Advanced API and we are looking for syntactic & ergonomics feedback.
     */
    bodyBuilder?: (props: JsonApiLinkHelperProps) => object;

    /**
     * Optional serialization function or a key that will be used look up the serializer to serialize the request body before transport.
     * @default if null will fallback to the default serializer
     */
    bodySerializer?: JsonApiLink.Serializer | string;

    /**
     * A per-request name denormalizer, this permits special endpoints to have their
     * field names remapped differently from the default.
     * @default Uses JsonApiLink.fieldNameDenormalizer
     */
    fieldNameDenormalizer?: JsonApiLink.FieldNameNormalizer;

    /**
     * Restructures the query result to give access to the full response.
     * Puts the flattened resource(s) under a `graphql` key, and returns the
     * original response body structure under a `jsonapi` key.
     * @default false
     */
    includeJsonapi?: boolean;
  }
}

const quickFindJsonApiDirective = (
  field: FieldNode,
): DirectiveNode | undefined => {
  if (field.directives && field.directives.length) {
    return field.directives.find(
      directive => 'jsonapi' === directive.name.value,
    );
  }
};
/**
 * The way graphql works today, it doesn't hand us the AST tree for our query, it hands us the ROOT
 * This method searches for REST-directive-attached nodes that are named to match this query.
 *
 * A little bit of wasted compute, but alternative would be a patch in graphql-anywhere.
 *
 * @param resultKey SearchKey for REST directive-attached item matching this sub-query
 * @param current current node in the REST-JSON-response
 * @param mainDefinition Parsed Query Definition
 * @param fragmentMap Map of Named Fragments
 * @param currentSelectionSet Current selection set we're filtering by
 */
function findRestDirectivesThenInsertNullsForOmittedFields(
  resultKey: string,
  current: any[] | object, // currentSelectionSet starts at root, so wait until we're inside a Field tagged with an @jsonapi directive to activate!
  mainDefinition: OperationDefinitionNode | FragmentDefinitionNode,
  fragmentMap: FragmentMap,
  currentSelectionSet: SelectionSetNode,
): any[] | object {
  if (
    currentSelectionSet == null ||
    null == current ||
    typeof current === 'number' ||
    typeof current === 'boolean' ||
    typeof current === 'string'
  ) {
    return current;
  }
  currentSelectionSet.selections.forEach(node => {
    if (isInlineFragment(node)) {
      findRestDirectivesThenInsertNullsForOmittedFields(
        resultKey,
        current,
        mainDefinition,
        fragmentMap,
        node.selectionSet,
      );
    } else if (node.kind === 'FragmentSpread') {
      const fragment = fragmentMap[node.name.value];
      findRestDirectivesThenInsertNullsForOmittedFields(
        resultKey,
        current,
        mainDefinition,
        fragmentMap,
        fragment.selectionSet,
      );
    } else if (isField(node)) {
      const name = resultKeyNameFromField(node);
      if (name === resultKey && quickFindJsonApiDirective(node)) {
        // Jackpot! We found our selectionSet!
        insertNullsForAnyOmittedFields(
          current,
          mainDefinition,
          fragmentMap,
          node.selectionSet,
        );
      } else {
        findRestDirectivesThenInsertNullsForOmittedFields(
          resultKey,
          current,
          mainDefinition,
          fragmentMap,
          node.selectionSet,
        );
      }
    } else {
      // This will give a TypeScript build-time error if you did something wrong or the AST changes!
      return ((node: never): never => {
        throw new Error('Unhandled Node Type in SelectionSetNode.selections');
      })(node);
    }
  });
  // Return current to have our result pass to next link in async promise chain!
  return current;
}
/**
 * Recursively walks a handed object in parallel with the Query SelectionSet,
 *  and inserts `null` for any field that is missing from the response.
 *
 * This is needed because ApolloClient will throw an error automatically if it's
 *  missing -- effectively making all of rest-link's selections implicitly non-optional.
 *
 * @param current Current object we're patching
 * @param mainDefinition Parsed Query Definition
 * @param fragmentMap Map of Named Fragments
 * @param currentSelectionSet Current selection set we're filtering by
 */
function insertNullsForAnyOmittedFields(
  current: any[] | object, // currentSelectionSet starts at root, so wait until we're inside a Field tagged with an @jsonapi directive to activate!
  mainDefinition: OperationDefinitionNode | FragmentDefinitionNode,
  fragmentMap: FragmentMap,
  currentSelectionSet: SelectionSetNode,
): void {
  if (
    currentSelectionSet == null ||
    null == current ||
    typeof current === 'number' ||
    typeof current === 'boolean' ||
    typeof current === 'string'
  ) {
    return;
  }
  if (Array.isArray(current)) {
    // If our current value is an array, process our selection set for each entry.
    current.forEach(c =>
      insertNullsForAnyOmittedFields(
        c,
        mainDefinition,
        fragmentMap,
        currentSelectionSet,
      ),
    );
    return;
  }
  currentSelectionSet.selections.forEach(node => {
    if (isInlineFragment(node)) {
      insertNullsForAnyOmittedFields(
        current,
        mainDefinition,
        fragmentMap,
        node.selectionSet,
      );
    } else if (node.kind === 'FragmentSpread') {
      const fragment = fragmentMap[node.name.value];
      insertNullsForAnyOmittedFields(
        current,
        mainDefinition,
        fragmentMap,
        fragment.selectionSet,
      );
    } else if (isField(node)) {
      const value = current[node.name.value];
      if (node.name.value === '__typename') {
        // Don't mess with special fields like __typename
      } else if (typeof value === 'undefined') {
        // Patch in a null where the field would have been marked as missing
        current[node.name.value] = null;
      } else if (
        value != null &&
        typeof value === 'object' &&
        node.selectionSet != null
      ) {
        insertNullsForAnyOmittedFields(
          value,
          mainDefinition,
          fragmentMap,
          node.selectionSet,
        );
      } else {
        // Other types (string, number) do not need recursive patching!
      }
    } else {
      // This will give a TypeScript build-time error if you did something wrong or the AST changes!
      return ((node: never): never => {
        throw new Error('Unhandled Node Type in SelectionSetNode.selections');
      })(node);
    }
  });
}

const getEndpointOptions = (
  endpoints: JsonApiLink.Endpoints,
  endpoint: JsonApiLink.Endpoint,
): JsonApiLink.EndpointOptions => {
  const result =
    endpoints[endpoint || DEFAULT_ENDPOINT_KEY] ||
    endpoints[DEFAULT_ENDPOINT_KEY];

  if (typeof result === 'string') {
    return { uri: result };
  }

  return result;
};

/** Internal Tool that Parses Paths for JsonApiLink -- This API should be considered experimental */
export class PathBuilder {
  /** For accelerating the replacement of paths that are used a lot */
  private static cache: {
    [path: string]: (props: JsonApiLink.PathBuilderProps) => string;
  } = {};
  /** Table to limit the amount of nagging (due to probable API Misuse) we do to once per path per launch */
  private static warnTable: { [key: string]: true } = {};
  /** Regexp that finds things that are eligible for variable replacement */
  private static argReplacement = /({[._a-zA-Z0-9]*})/;

  static replacerForPath(
    path: string,
  ): (props: JsonApiLink.PathBuilderProps) => string {
    if (path in PathBuilder.cache) {
      return PathBuilder.cache[path];
    }

    const queryOrigStartIndex = path.indexOf('?');
    const pathBits = path.split(PathBuilder.argReplacement);

    const chunkActions: Array<
      | true // We're enabling the qs-encoder
      | string // This is a raw string bit, don't mess with it
      | ((
          props: JsonApiLink.JsonApiLinkHelperProps,
          useQSEncoder: boolean,
        ) => string)
    > = [];

    let hasBegunQuery = false;
    pathBits.reduce((processedCount, bit) => {
      if (bit === '' || bit === '{}') {
        // Empty chunk, do nothing
        return processedCount + bit.length;
      }
      const nextIndex = processedCount + bit.length;
      if (bit[0] === '{' && bit[bit.length - 1] === '}') {
        // Replace some args!
        const _keyPath = bit.slice(1, bit.length - 1).split('.');

        chunkActions.push(
          (
            props: JsonApiLink.JsonApiLinkHelperProps,
            useQSEncoder: boolean,
          ) => {
            try {
              const value = PathBuilderLookupValue(props, _keyPath);
              if (
                !useQSEncoder ||
                (typeof value !== 'object' || value == null)
              ) {
                return String(value);
              } else {
                return qs.stringify(value);
              }
            } catch (e) {
              const key = [path, _keyPath.join('.')].join('|');
              if (!(key in PathBuilder.warnTable)) {
                console.warn(
                  'Warning: JsonApiLink caught an error while unpacking',
                  key,
                  "This tends to happen if you forgot to pass a parameter needed for creating an @jsonapi(path, or if JsonApiLink was configured to deeply unpack a path parameter that wasn't provided. This message will only log once per detected instance. Trouble-shooting hint: check @jsonapi(path: and the variables provided to this query.",
                );
                PathBuilder.warnTable[key] = true;
              }
              return '';
            }
          },
        );
      } else {
        chunkActions.push(bit);
        if (!hasBegunQuery && nextIndex >= queryOrigStartIndex) {
          hasBegunQuery = true;
          chunkActions.push(true);
        }
      }
      return nextIndex;
    }, 0);

    const result: (props: JsonApiLink.PathBuilderProps) => string = props => {
      let hasEnteredQuery = false;
      const tmp = chunkActions.reduce((accumulator: string, action): string => {
        if (typeof action === 'string') {
          return accumulator + action;
        } else if (typeof action === 'boolean') {
          hasEnteredQuery = true;
          return accumulator;
        } else {
          return accumulator + action(props, hasEnteredQuery);
        }
      }, '') as string;
      return tmp;
    };
    return (PathBuilder.cache[path] = result);
  }
}

/** Private Helper Function */
function PathBuilderLookupValue(tmp: object, keyPath: string[]) {
  if (keyPath.length === 0) {
    return tmp;
  }
  const remainingKeyPath = [...keyPath]; // Copy before mutating
  const key = remainingKeyPath.shift();
  return PathBuilderLookupValue(tmp[key], remainingKeyPath);
}

/**
 * Some keys should be passed through transparently without normalizing/de-normalizing
 */
const noMangleKeys = ['__typename'];

/** Recursively descends the provided object tree and converts all the keys */
const convertObjectKeys = (
  object: object,
  __converter: JsonApiLink.FieldNameNormalizer,
  keypath: string[] = [],
): object => {
  let converter: JsonApiLink.FieldNameNormalizer = null;
  if (__converter.length != 2) {
    converter = (name, keypath) => {
      return __converter(name);
    };
  } else {
    converter = __converter;
  }

  if (object == null || typeof object !== 'object') {
    // Object is a scalar or null / undefined => no keys to convert!
    return object;
  }

  // FileList/File are only available in some browser contexts
  // Notably: *not available* in react-native.
  if (
    ((global as any).FileList && object instanceof FileList) ||
    ((global as any).File && object instanceof File)
  ) {
    // Object is a FileList or File object => no keys to convert!
    return object;
  }

  if (Array.isArray(object)) {
    return object.map((o, index) =>
      convertObjectKeys(o, converter, [...keypath, String(index)]),
    );
  }

  return Object.keys(object).reduce((acc: any, key: string) => {
    let value = object[key];

    if (noMangleKeys.indexOf(key) !== -1) {
      acc[key] = value;
      return acc;
    }

    const nestedKeyPath = [...keypath, key];
    acc[converter(key, nestedKeyPath)] = convertObjectKeys(
      value,
      converter,
      nestedKeyPath,
    );
    return acc;
  }, {});
};

const noOpNameNormalizer: JsonApiLink.FieldNameNormalizer = (name: string) => {
  return name;
};

/**
 * Helper that makes sure our headers are of the right type to pass to Fetch
 */
export const normalizeHeaders = (
  headers: JsonApiLink.InitializationHeaders,
): Headers => {
  // Make sure that our headers object is of the right type
  if (headers instanceof Headers) {
    return headers;
  } else {
    return new Headers(headers || {});
  }
};

/**
 * Returns a new Headers Group that contains all the headers.
 * - If there are duplicates, they will be in the returned header set multiple times!
 */
export const concatHeadersMergePolicy: JsonApiLink.HeadersMergePolicy = (
  ...headerGroups: Headers[]
): Headers => {
  return headerGroups.reduce((accumulator, current) => {
    if (!current) {
      return accumulator;
    }
    if (!current.forEach) {
      current = normalizeHeaders(current);
    }
    current.forEach((value, key) => {
      accumulator.append(key, value);
    });

    return accumulator;
  }, new Headers());
};

/**
 * This merge policy deletes any matching headers from the link's default headers.
 * - Pass headersToOverride array & a headers arg to context and this policy will automatically be selected.
 */
export const overrideHeadersMergePolicy = (
  linkHeaders: Headers,
  headersToOverride: string[],
  requestHeaders: Headers | null,
): Headers => {
  const result = new Headers();
  linkHeaders.forEach((value, key) => {
    if (headersToOverride.indexOf(key) !== -1) {
      return;
    }
    result.append(key, value);
  });
  return concatHeadersMergePolicy(result, requestHeaders || new Headers());
};
export const overrideHeadersMergePolicyHelper = overrideHeadersMergePolicy; // Deprecated name

const makeOverrideHeadersMergePolicy = (
  headersToOverride: string[],
): JsonApiLink.HeadersMergePolicy => {
  return (linkHeaders, requestHeaders) => {
    return overrideHeadersMergePolicy(
      linkHeaders,
      headersToOverride,
      requestHeaders,
    );
  };
};

const SUPPORTED_HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const validateRequestMethodForOperationType = (
  method: string,
  operationType: OperationTypeNode,
): void => {
  switch (operationType) {
    case 'query':
      if (SUPPORTED_HTTP_VERBS.indexOf(method.toUpperCase()) !== -1) {
        return;
      }
      throw new Error(
        `A "query" operation can only support "GET" requests but got "${method}".`,
      );
    case 'mutation':
      if (SUPPORTED_HTTP_VERBS.indexOf(method.toUpperCase()) !== -1) {
        return;
      }
      throw new Error('"mutation" operations do not support that HTTP-verb');
    case 'subscription':
      throw new Error('A "subscription" operation is not supported yet.');
    default:
      const _exhaustiveCheck: never = operationType;
      return _exhaustiveCheck;
  }
};

/**
 * Utility to build & throw a JS Error from a "failed" REST-response
 * @param response: HTTP Response object for this request
 * @param result: Promise that will render the body of the response
 * @param message: Human-facing error message
 */
const rethrowServerSideError = (
  response: Response,
  result: any,
  message: string,
) => {
  const error = new Error(message) as JsonApiLink.ServerError;

  error.response = response;
  error.statusCode = response.status;
  error.result = result;

  throw error;
};

/** Apollo-Link getContext, provided from the user & mutated by upstream links */
interface LinkChainContext {
  /** Credentials Policy for Fetch */
  credentials?: RequestCredentials | null;

  /** Headers the user wants to set on this request. See also headersMergePolicy */
  headers?: JsonApiLink.InitializationHeaders | null;

  /** Will default to concatHeadersMergePolicy unless headersToOverride is set */
  headersMergePolicy?: JsonApiLink.HeadersMergePolicy | null;

  /** List of headers to override, passing this will swap headersMergePolicy if necessary */
  headersToOverride?: string[] | null;

  /** An array of the responses from each fetched URL, useful for accessing headers in earlier links */
  restResponses?: Response[];
}

/** Context passed via graphql() to our resolver */
interface RequestContext {
  /** Headers the user wants to set on this request. See also headersMergePolicy */
  headers: Headers;

  /** Credentials Policy for Fetch */
  credentials?: RequestCredentials | null;

  /** Exported variables fulfilled in this request, using @export(as:). They are stored keyed by node to support deeply nested structures with exports at multiple levels */
  exportVariablesByNode: Map<any, { [key: string]: any }>;

  endpoints: JsonApiLink.Endpoints;
  customFetch: JsonApiLink.CustomFetch;
  operationType: OperationTypeNode;
  typeNameNormalizer: JsonApiLink.TypeNameNormalizer;
  fieldNameNormalizer: JsonApiLink.FieldNameNormalizer;
  fieldNameDenormalizer: JsonApiLink.FieldNameNormalizer;
  mainDefinition: OperationDefinitionNode | FragmentDefinitionNode;
  fragmentDefinitions: FragmentDefinitionNode[];
  serializers: JsonApiLink.Serializers;

  /** An array of the responses from each fetched URL */
  responses: Response[];
}

const addTypeToNode = (node, typename) => {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }

  if (!Array.isArray(node)) {
    node['__typename'] = typename;
    return node;
  }

  return node.map(item => {
    return addTypeToNode(item, typename);
  });
};

const resolver: Resolver = async (
  fieldName: string,
  root: any,
  args: any,
  context: RequestContext,
  info: ExecInfo,
) => {
  const { directives, isLeaf, resultKey } = info;
  const { exportVariablesByNode } = context;

  const exportVariables = exportVariablesByNode.get(root) || {};

  /** creates a copy of this node's export variables for its child nodes. iterates over array results to provide for each child. returns the passed result. */
  const copyExportVariables = <T>(result: T): T => {
    if (result instanceof Array) {
      result.forEach(copyExportVariables);
    } else {
      // export variables are stored keyed on the node they are for
      exportVariablesByNode.set(result, { ...exportVariables });
    }

    return result;
  };

  // Support GraphQL Aliases!
  const aliasedNode = (root || {})[resultKey];
  const preAliasingNode = (root || {})[fieldName];

  const isATypeCall = directives && directives.type;

  if (!isLeaf && isATypeCall) {
    // @type(name: ) is only supported inside apollo-link-json-api at this time
    // so use the preAliasingNode as we're responsible for implementing aliasing!
    // Also: exit early, since @type(name: ) && @jsonapi() can't both exist on the same node.
    if (directives.jsonapi) {
      throw new Error(
        'Invalid use of @type(name: ...) directive on a call that also has @jsonapi(...)',
      );
    }
    return addTypeToNode(preAliasingNode, directives.type.name);
  }

  const isNotAJsonApiCall = !directives || !directives.jsonapi;
  if (isNotAJsonApiCall) {
    // This is not tagged with @jsonapi()
    // This might not belong to us so return the aliasNode version preferentially
    return copyExportVariables(aliasedNode || preAliasingNode);
  }
  const {
    credentials,
    endpoints,
    headers,
    customFetch,
    operationType,
    mainDefinition,
    fragmentDefinitions,
    typeNameNormalizer,
    fieldNameNormalizer,
    fieldNameDenormalizer: linkLevelNameDenormalizer,
    serializers,
  } = context;

  const fragmentMap = createFragmentMap(fragmentDefinitions);

  let {
    path,
    endpoint,
    pathBuilder,
  } = directives.jsonapi as JsonApiLink.DirectiveOptions;

  const endpointOption = getEndpointOptions(endpoints, endpoint);
  const neitherPathsProvided = path == null && pathBuilder == null;

  if (neitherPathsProvided) {
    throw new Error(
      `One of ("path" | "pathBuilder") must be set in the @jsonapi() directive. This request had neither, please add one`,
    );
  }
  if (!pathBuilder) {
    if (path.includes(':')) {
      throw new Error(
        "'@jsonapi(path:' contains a ':' colon, this format is not supported",
      );
    }
    pathBuilder = PathBuilder.replacerForPath(path);
  }
  const allParams: JsonApiLink.PathBuilderProps = {
    args,
    exportVariables,
    context,
    '@jsonapi': directives.jsonapi,
    replacer: pathBuilder,
  };
  const pathWithParams = pathBuilder(allParams);

  let {
    method,
    fieldNameDenormalizer: perRequestNameDenormalizer,
    includeJsonapi,
  } = directives.jsonapi as JsonApiLink.DirectiveOptions;
  if (!method) {
    method = 'GET';
  }
  if (!includeJsonapi) {
    includeJsonapi = false;
  }

  let body = undefined;
  let overrideHeaders: Headers = undefined;
  if (-1 === ['GET', 'DELETE'].indexOf(method)) {
    body = convertObjectKeys(
      allParams.args.input,
      perRequestNameDenormalizer ||
        linkLevelNameDenormalizer ||
        noOpNameNormalizer,
    );

    let serializedBody: JsonApiLink.SerializedBody;

    serializedBody = serializers[DEFAULT_SERIALIZER_KEY](body, headers);
    body = serializedBody.body;
    overrideHeaders = new Headers(serializedBody.headers);
  }

  validateRequestMethodForOperationType(method, operationType || 'query');

  const requestParams = {
    method,
    headers: overrideHeaders || headers,
    body: body,

    // Only set credentials if they're non-null as some browsers throw an exception:
    // https://github.com/apollographql/apollo-link-rest/issues/121#issuecomment-396049677
    ...(credentials ? { credentials } : {}),
  };
  const requestUrl = `${endpointOption.uri}${pathWithParams}`;

  const response = await (customFetch || fetch)(requestUrl, requestParams);
  context.responses.push(response);

  let result;
  if (response.ok) {
    if (
      response.status === 204 ||
      response.headers.get('Content-Length') === '0'
    ) {
      // HTTP-204 means "no-content", similarly Content-Length implies the same
      // This commonly occurs when you POST/PUT to the server, and it acknowledges
      // success, but doesn't return your Resource.
      result = {};
    } else {
      try {
        result = await jsonApiTransformer(
          response,
          typeNameNormalizer,
          includeJsonapi,
        );
      } catch (err) {
        console.warn('An error occurred in jsonApiTransformer:');
        throw err;
      }
    }
  } else if (response.status === 404) {
    // In a GraphQL context a missing resource should be indicated by
    // a null value rather than throwing a network error
    result = null;
  } else {
    // Default error handling:
    // Throw a JSError, that will be available under the
    // "Network error" category in apollo-link-error
    let parsed: any;
    // responses need to be cloned as they can only be read once
    try {
      parsed = await response.clone().json();
    } catch (error) {
      // its not json
      parsed = await response.clone().text();
    }
    rethrowServerSideError(
      response,
      parsed,
      `Response not successful: Received status code ${response.status}`,
    );
  }

  if (fieldNameNormalizer !== null) {
    result = convertObjectKeys(result, fieldNameNormalizer);
  }

  result = findRestDirectivesThenInsertNullsForOmittedFields(
    resultKey,
    result,
    mainDefinition,
    fragmentMap,
    mainDefinition.selectionSet,
  );

  return copyExportVariables(result);
};

/**
 * Default key to use when the @jsonapi directive omits the "endpoint" parameter.
 */
const DEFAULT_ENDPOINT_KEY = '';

/**
 * Default key to use when the @jsonapi directive omits the "bodySerializers" parameter.
 */
const DEFAULT_SERIALIZER_KEY = '';

const DEFAULT_JSON_SERIALIZER: JsonApiLink.Serializer = (
  data: any,
  headers: Headers,
) => {
  if (!headers.has('content-type')) {
    headers.append('Content-Type', 'application/vnd.api+json');
  }
  return {
    body: JSON.stringify(data),
    headers: headers,
  };
};

/**
 * JsonApiLink is an apollo-link for communicating with REST services using GraphQL on the client-side
 */
export class JsonApiLink extends ApolloLink {
  private readonly endpoints: JsonApiLink.Endpoints;
  private readonly headers: Headers;
  private readonly typeNameNormalizer: JsonApiLink.TypeNameNormalizer;
  private readonly fieldNameNormalizer: JsonApiLink.FieldNameNormalizer;
  private readonly fieldNameDenormalizer: JsonApiLink.FieldNameNormalizer;
  private readonly credentials: RequestCredentials;
  private readonly customFetch: JsonApiLink.CustomFetch;
  private readonly serializers: JsonApiLink.Serializers;

  constructor({
    uri,
    endpoints,
    headers,
    typeNameNormalizer,
    fieldNameNormalizer,
    fieldNameDenormalizer,
    customFetch,
    credentials,
    bodySerializers,
    defaultSerializer,
  }: JsonApiLink.Options) {
    super();
    const fallback = {};
    fallback[DEFAULT_ENDPOINT_KEY] = uri || '';
    this.endpoints = Object.assign({}, endpoints || fallback);

    if (uri == null && endpoints == null) {
      throw new Error(
        'A JsonApiLink must be initialized with either 1 uri, or a map of keyed-endpoints',
      );
    }
    if (uri != null) {
      const currentDefaultURI = (endpoints || {})[DEFAULT_ENDPOINT_KEY];
      if (currentDefaultURI != null && currentDefaultURI != uri) {
        throw new Error(
          "JsonApiLink was configured with a default uri that doesn't match what's passed in to the endpoints map.",
        );
      }
      this.endpoints[DEFAULT_ENDPOINT_KEY] = uri;
    }

    if (this.endpoints[DEFAULT_ENDPOINT_KEY] == null) {
      console.warn(
        'JsonApiLink configured without a default URI. All @jsonapi(…) directives must provide an endpoint key!',
      );
    }

    if (
      bodySerializers &&
      bodySerializers.hasOwnProperty(DEFAULT_SERIALIZER_KEY)
    ) {
      console.warn(
        'JsonApiLink was configured to override the default serializer! This may result in unexpected behavior',
      );
    }

    this.typeNameNormalizer = typeNameNormalizer || identity;
    this.fieldNameNormalizer = fieldNameNormalizer || null;
    this.fieldNameDenormalizer = fieldNameDenormalizer || null;
    this.headers = normalizeHeaders(headers);
    this.credentials = credentials || null;
    this.customFetch = customFetch;
    this.serializers = {
      [DEFAULT_SERIALIZER_KEY]: defaultSerializer || DEFAULT_JSON_SERIALIZER,
      ...(bodySerializers || {}),
    };
  }

  public request(
    operation: Operation,
    forward?: NextLink,
  ): Observable<FetchResult> | null {
    const { query, variables, getContext, setContext } = operation;
    const context: LinkChainContext | any = getContext() as any;
    const isJsonApiQuery = hasDirectives(['jsonapi'], query);
    if (!isJsonApiQuery) {
      return forward(operation);
    }

    const nonRest = removeRestSetsFromDocument(query);

    // 1. Use the user's merge policy if any
    let headersMergePolicy: JsonApiLink.HeadersMergePolicy =
      context.headersMergePolicy;
    if (
      headersMergePolicy == null &&
      Array.isArray(context.headersToOverride)
    ) {
      // 2.a. Override just the passed in headers, if user provided that optional array
      headersMergePolicy = makeOverrideHeadersMergePolicy(
        context.headersToOverride,
      );
    } else if (headersMergePolicy == null) {
      // 2.b Glue the link (default) headers to the request-context headers
      headersMergePolicy = concatHeadersMergePolicy;
    }

    const headers = headersMergePolicy(this.headers, context.headers);
    if (!headers.has('Accept')) {
      // Since we assume a json body on successful responses set the Accept
      // header accordingly if it is not provided by the user
      headers.append('Accept', 'application/vnd.api+json');
    }

    const credentials: RequestCredentials =
      context.credentials || this.credentials;

    const queryWithTypename = addTypenameToDocument(query);

    const mainDefinition = getMainDefinition(query);
    const fragmentDefinitions = getFragmentDefinitions(query);

    const operationType: OperationTypeNode =
      (mainDefinition || ({} as any)).operation || 'query';

    const requestContext: RequestContext = {
      headers,
      endpoints: this.endpoints,
      // Provide an empty map for this request's exports to be stuffed into
      exportVariablesByNode: new Map(),
      credentials,
      customFetch: this.customFetch,
      operationType,
      typeNameNormalizer: this.typeNameNormalizer,
      fieldNameNormalizer: this.fieldNameNormalizer,
      fieldNameDenormalizer: this.fieldNameDenormalizer,
      mainDefinition,
      fragmentDefinitions,
      serializers: this.serializers,
      responses: [],
    };
    const resolverOptions = {};
    let obs;
    if (nonRest && forward) {
      operation.query = nonRest;
      obs = forward(operation);
    } else obs = Observable.of({ data: {} });

    return obs.flatMap(
      ({ data, errors }) =>
        new Observable(observer => {
          graphql(
            resolver,
            queryWithTypename,
            data,
            requestContext,
            variables,
            resolverOptions,
          )
            .then(data => {
              setContext({
                restResponses: (context.restResponses || []).concat(
                  requestContext.responses,
                ),
              });
              observer.next({ data, errors });
              observer.complete();
            })
            .catch(err => {
              if (err.name === 'AbortError') return;
              if (err.result && err.result.errors) {
                observer.next(err.result);
              }
              observer.error(err);
            });
        }),
    );
  }
}
