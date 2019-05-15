# JSON API Link [![Build Status](https://travis-ci.com/Rsullivan00/apollo-link-json-api.svg?branch=master)](https://travis-ci.com/Rsullivan00/apollo-link-json-api)

## Purpose

An Apollo Link to easily use GraphQL with a JSON API compliant server.

## Installation


```bash
npm install apollo-link-json-api apollo-link graphql graphql-anywhere qs --save # or `yarn add apollo-link-rest apollo-link graphql graphql-anywhere qs`
```

`apollo-link`, `graphql`, `qs` and `graphql-anywhere` are peer dependencies needed by `apollo-link-json-api`.

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
    author @jsonApi(path: "authors/1") {
      name
    }
  }
`;

// Invoke the query and log the person's name
client.query({ query }).then(response => {
  console.log(response.data.name);
});
```

## Options

JSON API Link takes an object with some options on it to customize the behavior of the link. The options you can pass are outlined below:

- `uri`: the URI key is a string endpoint (optional when `endpoints` provides a default)
- `endpoints`: root endpoint (uri) to apply paths to or a map of endpoints
- `customFetch`: a custom `fetch` to handle REST calls
- `headers`: an object representing values to be sent as headers on the request
- `credentials`: a string representing the credentials policy you want for the fetch call
- `fieldNameNormalizer`: function that takes the response field name and converts it into a GraphQL compliant name

## Context

JSON API Link uses the `headers` field on the context to allow passing headers to the HTTP request. It also supports the `credentials` field for defining credentials policy.

- `headers`: an object representing values to be sent as headers on the request
- `credentials`: a string representing the credentials policy you want for the fetch call

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
