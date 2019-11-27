# JSON API Link [![Build Status](https://travis-ci.com/Rsullivan00/apollo-link-json-api.svg?branch=master)](https://travis-ci.com/Rsullivan00/apollo-link-json-api)  [![codecov](https://codecov.io/gh/Rsullivan00/apollo-link-json-api/branch/master/graph/badge.svg)](https://codecov.io/gh/Rsullivan00/apollo-link-json-api)


## Purpose

An Apollo Link to easily use GraphQL with a [JSON API](https://jsonapi.org/)
compliant server.

Built on top of
[`apollo-link-rest`](https://github.com/apollographql/apollo-link-rest/). If you
have a non-JSON API REST service, check that out as an alternative.

## Installation


```bash
npm install apollo-link-json-api apollo-link graphql graphql-anywhere qs humps --save

# or

yarn add apollo-link-json-api apollo-link graphql graphql-anywhere qs humps
```

`apollo-link`, `graphql`, `qs`, `humps`, and `graphql-anywhere` are peer dependencies needed by `apollo-link-json-api`.

## Usage

### Basics

```js
import { JsonApiLink } from "apollo-link-json-api";
// Other necessary imports...

// Create a JsonApiLink for the JSON API
// If you are using multiple link types, jsonApiLink should go before httpLink,
// as httpLink will swallow any calls that should be routed through jsonApi!
const jsonApiLink = new JsonApiLink({
  uri: 'http://jsonapiplayground.reyesoft.com/v2/',
});

// Configure the ApolloClient with the default cache and JsonApiLink
const client = new ApolloClient({
  link: jsonApiLink,
  cache: new InMemoryCache(),
});

// A simple query to retrieve data about the first author
const query = gql`
  query firstAuthor {
    author @jsonapi(path: "authors/1") {
      name
    }
  }
`;

// Invoke the query and log the person's name
client.query({ query }).then(response => {
  console.log(response.data.name);
});
```

### Advanced Querying

JSON API Link supports [unpacking related resources](https://jsonapi.org/format/#document-compound-documents)
into a friendlier GraphQL query structure.

```js
const query = gql`
  query firstAuthor {
    author @jsonapi(path: "authors/1?include=series,series.books") {
      name
      series {
        title
        books {
          title
        }
      }
    }
  }
`;

```

While JSON API Link does support running multiple nested queries, prefer
sideloading resources in a single request by using the `?include` parameter if
your JSON API server supports it.

```js
// Avoid this
const badQuery = gql`
  query firstAuthor {
    author @jsonapi(path: "authors/1") {
      name
      series @jsonapi(path: "authors/1/series") {
        title
      }
    }
  }
`;

// Prefer this
const query = gql`
  query firstAuthor {
    author @jsonapi(path: "authors/1?include=series") {
      name
      series {
        title
      }
    }
  }
`;
```

### Mutations

```js
import React from 'react'
import gql from 'graphql-tag'
import { Mutation } from 'react-apollo'

export const UPDATE_BOOK_TITLE = gql`
  mutation UpdateBookTitle($input: UpdateBookTitleInput!) {
    book(input: $input) @jsonapi(path: "/books/{args.input.data.id}", method: "PATCH") {
      title
    }
  }
`

const UpdateBookTitleButton = ({ bookId }) => (
  <Mutation
    mutation={UPDATE_BOOK_TITLE}
    update={(store, { data: { book } }) => {
      // Update your Apollo cache with result
      console.log(book.title)
    }}
  >
    {mutate => (
      <button onClick={() => 
        mutate({
          variables: {
            input: {
              data: {
                id: bookId,
                type: 'books',
                attributes: { title: 'Changed title!' }
              }
            }
          },
          optimisticResponse: {
            book: {
              __typename: 'books',
              title: 'Changed title!'
            }
          }
        })
        }>
        Update your book title!
        </button>
    )}
  </Mutation>
)
```

## Options

JSON API Link takes an object with some options on it to customize the behavior of the link. The options you can pass are outlined below:

- `uri`: the URI key is a string endpoint (optional when `endpoints` provides a default)
- `endpoints`: root endpoint (uri) to apply paths to or a map of endpoints
- `customFetch`: a custom `fetch` to handle API calls
- `headers`: an object representing values to be sent as headers on the request
- `credentials`: a string representing the credentials policy you want for the fetch call
- `fieldNameNormalizer`: function that takes the response field name and converts it into a GraphQL compliant name
- `fieldNameDenormalizer`: function that takes the JavaScript object key name and converts it into a JSON API compliant name
- `typeNameNormalizer`: function that takes the JSON API resource type and
    converts it to a GraphQL `__typename`.

## Context

JSON API Link uses the `headers` field on the context to allow passing headers to the HTTP request. It also supports the `credentials` field for defining credentials policy.

- `headers`: an object representing values to be sent as headers on the request
- `credentials`: a string representing the credentials policy you want for the fetch call

## Accessing metadata and links

By default, this library flattens your server response. If you need to access
values that are unavailable by this simple querying method, you can add
`includeJsonapi: true` to your `@jsonapi` directive, which will instead return
the flattened "GraphQL-like" structure under a `graphql` key, and the original
response structure under a `jsonapi` key. Resources are still nested in a tree
structure under the `jsonapi` key, but `data`/`attribute`/`relatioship` keys are
not flattened out.

```gql
query authorsWithMeta {
  authors @jsonapi(path: "authors?include=series", includeJsonapi: true) {
    graphql {
      name
      series {
        title
      }
    }

    jsonapi {
      meta {
        pageCount
      }
      links {
        first
        last
        current
      }
      // The resource data is available here, though it's probably easier to
      // grab from the `graphql` structure
      data {
        attributes {
          name
        }
        relationships {
          series {
            data {
              attributes {
                title
              }
            }
            links {
              related
            }
          }
        }
      }
    }
  }
}
```

## Contributing

This project uses TypeScript to bring static types to JavaScript and uses Jest for testing. To get started, clone the repo and run the following commands:

```bash
npm install # or `yarn`

npm test # or `yarn test` to run tests
npm test -- --watch # run tests in watch mode

npm run check-types # or `yarn check-types` to check TypeScript types
```

To run the library locally in another project, you can do the following:

```bash
npm link

# in the project you want to run this in
npm link apollo-link-json-api
```
