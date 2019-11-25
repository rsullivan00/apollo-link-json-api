import { execute, makePromise, ApolloLink, from } from 'apollo-link';
import { ApolloClient } from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { onError } from 'apollo-link-error';

import gql, { disableFragmentWarnings } from 'graphql-tag';
disableFragmentWarnings();

import { camelize, decamelize, pascalize } from 'humps';
import * as fetchMock from 'fetch-mock';

import {
  JsonApiLink,
  validateRequestMethodForOperationType,
  normalizeHeaders,
} from '../jsonApiLink';
import { HttpLink } from 'apollo-link-http';
import { withClientState } from 'apollo-link-state';

/** Helper for extracting a simple object of headers from the HTTP-fetch Headers class */
const flattenHeaders: ({ headers: Headers }) => { [key: string]: string } = ({
  headers,
}) => {
  const headersFlattened: { [key: string]: string } = {};
  headers.forEach((value, key) => {
    headersFlattened[key] = value;
  });
  return headersFlattened;
};

/** Helper that flattens headers & preserves duplicate objects */
const orderDupPreservingFlattenedHeaders: (
  { headers: Headers },
) => string[] = ({ headers }) => {
  const orderedFlattened = [];
  headers.forEach((value, key) => {
    orderedFlattened.push(`${key}: ${value}`);
  });
  return orderedFlattened;
};

const sampleQuery = gql`
  query post {
    post(id: "1") @jsonapi(path: "/post/{args.id}") {
      id
    }
  }
`;

type Result = { [index: string]: any };

describe('Configuration', async () => {
  describe('Errors', async () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it('throws without any config', () => {
      expect.assertions(3);

      expect(() => {
        new JsonApiLink(undefined);
      }).toThrow();
      expect(() => {
        new JsonApiLink({} as any);
      }).toThrow();
      expect(() => {
        new JsonApiLink({ bogus: '' } as any);
      }).toThrow();
    });

    it('throws with mismatched config', () => {
      expect.assertions(1);
      expect(() => {
        new JsonApiLink({ uri: '/correct', endpoints: { '': '/mismatched' } });
      }).toThrow();
    });

    it('throws if missing both path and pathBuilder', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });
      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post @jsonapi(placeholder: "placeholder") {
            id
            title
          }
        }
      `;

      try {
        await makePromise<Result>(
          execute(link, {
            operationName: 'postTitle',
            query: postTitleQuery,
          }),
        );
      } catch (error) {
        expect(error.message).toBe(
          'One of ("path" | "pathBuilder") must be set in the @jsonapi() directive. This request had neither, please add one',
        );
      }
    });

    it("Doesn't throw on good configs", () => {
      expect.assertions(1);

      new JsonApiLink({ uri: '/correct' });
      new JsonApiLink({ uri: '/correct', endpoints: { other: '/other' } });
      new JsonApiLink({
        uri: '/correct',
        endpoints: { '': '/correct', other: '/other' },
      });
      new JsonApiLink({ endpoints: { '': '/correct', other: '/other' } });

      expect(true).toBe(true);
    });
  });

  describe('Field name normalizer', async () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('should apply fieldNameNormalizer if specified', async () => {
      expect.assertions(3);
      const link = new JsonApiLink({
        uri: '/api',
        fieldNameNormalizer: camelize,
      });
      // "Server" returns TitleCased and decamelized fields
      // fieldNameNormalizer changes them to camelize
      const post = {
        data: { type: 'posts', id: '1', attributes: { Title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const tags = {
        data: [
          {
            type: 'tags',
            id: '1',
            attributes: { Name: 'apollo', tag_description: 'once' },
          },
          {
            type: 'tags',
            id: '2',
            attributes: { Name: 'graphql', tag_description: 'twice' },
          },
        ],
      };
      fetchMock.get('/api/tags', tags);

      const postAndTags = gql`
        query postAndTags {
          post @jsonapi(path: "/post/1") {
            id
            title
            tags @jsonapi(path: "/tags") {
              name
              tagDescription
            }
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postAndTags,
        }),
      );

      expect(data.post.title).toBeDefined();
      expect(data.post.tags[0].name).toBeDefined();
      expect(data.post.tags[0].tagDescription).toEqual('once');
    });

    it('should preserve __typename when using fieldNameNormalizer', async () => {
      expect.assertions(2);
      const link = new JsonApiLink({
        uri: '/api',
        fieldNameNormalizer: camelize,
      });
      const post = {
        data: {
          type: 'super_posts',
          id: '1',
          attributes: { Title: 'Love apollo' },
        },
      };
      fetchMock.get('/api/posts/1', post);

      const tags = {
        data: [
          { type: 'tags', id: '1', attributes: { Name: 'apollo' } },
          { type: 'tags', id: '2', attributes: { Name: 'graphql' } },
        ],
      };
      fetchMock.get('/api/tags', tags);

      const postAndTags = gql`
        query postAndTags {
          post @jsonapi(path: "/posts/1") {
            __typename
            id
            title
            tags @jsonapi(path: "/tags") {
              name
            }
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postAndTags,
        }),
      );

      expect(data.post.__typename).toBeDefined();
      expect(data.post.__typename).toEqual('super_posts');
    });
  });

  describe('typeNameNormalizer', async () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it('should apply typeNameNormalizer if specified', async () => {
      expect.assertions(2);
      const link = new JsonApiLink({
        uri: '/api',
        typeNameNormalizer: type => `My${pascalize(type)}`,
      });
      const post = {
        data: { type: 'posts', id: '1', attributes: { Title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const tags = {
        data: [
          {
            type: 'tags',
            id: '1',
            attributes: { Name: 'apollo', tag_description: 'once' },
          },
          {
            type: 'tags',
            id: '2',
            attributes: { Name: 'graphql', tag_description: 'twice' },
          },
        ],
      };
      fetchMock.get('/api/tags', tags);

      const postAndTags = gql`
        query postAndTags {
          post @jsonapi(path: "/post/1") {
            id
            title
            tags @jsonapi(path: "/tags") {
              name
            }
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postAndTags,
        }),
      );

      expect(data.post.__typename).toEqual('MyPosts');
      expect(data.post.tags[0].__typename).toEqual('MyTags');
    });
  });

  describe('Custom fetch', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('should apply customFetch if specified', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({
        uri: '/api',
        customFetch: (uri, options) =>
          new Promise((resolve, reject) => {
            const body = JSON.stringify({
              data: {
                type: 'posts',
                id: '1',
                attributes: { title: 'custom' },
              },
            });
            resolve(new Response(body));
          }),
      });

      const postTitle = gql`
        query postTitle {
          post @jsonapi(path: "/posts/1") {
            title
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitle,
        }),
      );

      expect(data.post.title).toBe('custom');
    });
  });

  describe('Default endpoint', () => {
    it('should produce a warning if not specified', async () => {
      let warning = '';
      const warn = message => (warning = message);

      console['warn'] = jest.fn(warn);

      new JsonApiLink({
        endpoints: {
          endpointUri: '/api',
        },
      });

      expect(warning).toBe(
        'JsonApiLink configured without a default URI. All @jsonapi(…) directives must provide an endpoint key!',
      );
    });

    it('should not produce a warning when specified', async () => {
      let warning = '';
      const warn = message => (warning = message);

      console['warn'] = jest.fn(warn);

      new JsonApiLink({
        uri: '/api/v1',
        endpoints: {
          endpointUri: '/api/v2',
        },
      });

      expect(warning).toBe('');
    });
  });
});

describe('Query single call', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can run a simple query', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const post = {
      data: {
        id: '1',
        type: 'posts',
        attributes: { title: 'Love apollo' },
      },
    };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @jsonapi(path: "/post/1") {
          id
          type
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({
      post: {
        id: '1',
        type: 'posts',
        title: 'Love apollo',
        __typename: 'posts',
      },
    });
  });

  it('can access top-level meta and links', async () => {
    expect.assertions(1);
    const link = new JsonApiLink({ uri: '/api' });
    const post = {
      data: {
        id: '1',
        type: 'posts',
        attributes: { title: 'Love apollo' },
      },
      meta: {
        my: 'stuff',
      },
      links: {
        self: '/posts/1',
      },
    };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @jsonapi(path: "/post/1", includeJsonapi: true) {
          jsonapi {
            meta {
              my
            }
            links {
              self
            }
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({
      post: {
        jsonapi: {
          meta: { my: 'stuff' },
          links: { self: '/posts/1' },
        },
      },
    });
  });

  it('can access full response structure alongside flattened', async () => {
    expect.assertions(1);
    const link = new JsonApiLink({ uri: '/api' });
    const author = {
      id: '2',
      type: 'author',
      attributes: {
        name: 'John Irving',
      },
      meta: {
        something: 'special',
      },
      links: {
        self: '/authors/2',
      },
    };
    const comment = {
      id: '3',
      type: 'comment',
      attributes: { text: 'hi' },
      links: { self: '/comments/3' },
    };
    const post = {
      data: {
        id: '1',
        type: 'posts',
        attributes: { title: 'Love apollo' },
        relationships: {
          author: {
            data: {
              id: author.id,
              type: author.type,
            },
          },
          comments: { data: [{ id: comment.id, type: comment.type }] },
        },
      },
      included: [author, comment],
    };
    fetchMock.get('/api/post/1', post);
    const postTitleQuery = gql`
      query postTitle {
        post @jsonapi(path: "/post/1", includeJsonapi: true) {
          graphql {
            title
            author {
              name
            }
            comments {
              text
            }
          }
          jsonapi {
            data {
              attributes {
                title
              }
              relationships {
                author {
                  data {
                    links {
                      self
                    }
                    meta {
                      something
                    }
                  }
                }
                comments {
                  data {
                    links {
                      self
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({
      post: {
        graphql: {
          title: post.data.attributes.title,
          author: {
            name: author.attributes.name,
          },
          comments: [
            {
              text: comment.attributes.text,
            },
          ],
        },
        jsonapi: {
          data: {
            attributes: {
              title: post.data.attributes.title,
            },
            relationships: {
              author: {
                data: {
                  links: {
                    self: author.links.self,
                  },
                },
              },
              comments: {
                data: [
                  {
                    links: { self: comment.links.self },
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('can handle array results', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const tags = [
      { id: '1', type: 'tags', attributes: { name: 'apollo' } },
      { id: '2', type: 'tags', attributes: { name: 'graphql' } },
    ];
    fetchMock.get('/api/tags', { data: tags });

    const tagsQuery = gql`
      query allTags {
        tags @jsonapi(path: "/tags") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'allTags',
        query: tagsQuery,
      }),
    );

    expect(data).toMatchObject({
      tags: [
        { name: 'apollo', __typename: 'tags' },
        { name: 'graphql', __typename: 'tags' },
      ],
    });
  });

  it('filters the query result', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      id: '1',
      type: 'posts',
      attributes: {
        title: 'Love apollo',
        content: 'Best graphql client ever.',
      },
    };
    fetchMock.get('/api/post/1', { data: post });

    const postTitleQuery = gql`
      query postTitle {
        post @jsonapi(type: "Post", path: "/post/1") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data.post.content).toBeUndefined();
  });

  it('can pass param to a query with a variable', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      id: '1',
      type: 'posts',
      attributes: { title: 'Love apollo' },
    };
    fetchMock.get('/api/post/1', { data: post });

    const postTitleQuery = gql`
      query postTitle {
        post(id: $id) @jsonapi(path: "/post/{args.id}") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
        variables: { id: '1' },
      }),
    );

    expect(data.post.title).toBe(post.attributes.title);
  });

  it('can pass param with `0` value to a query with a variable', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      id: '1',
      type: 'posts',
      attributes: { title: 'Love apollo' },
    };
    fetchMock.get('/api/feed?offset=0', { data: [post] });

    const feedQuery = gql`
      query feed {
        posts(offset: $offset) @jsonapi(path: "/feed?offset={args.offset}") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'feed',
        query: feedQuery,
        variables: { offset: 0 },
      }),
    );

    expect(data.posts[0].title).toBe(post.attributes.title);
  });

  it('can query through relationships', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const author = {
      id: '1',
      type: 'authors',
      attributes: { name: 'George R. R. Martin' },
    };
    const bookWithRelated = {
      id: '2',
      type: 'books',
      attributes: { title: 'A Game of Thrones' },
      relationships: {
        author: { data: { id: author.id, type: author.type } },
      },
    };

    fetchMock.get('/api/books/2?include=author', {
      data: bookWithRelated,
      included: [author],
    });

    const bookWithAuthorQuery = gql`
      query bookWithAuthor {
        book @jsonapi(path: "/books/2?include=author") {
          id
          title
          author {
            id
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'bookWithAuthor',
        query: bookWithAuthorQuery,
      }),
    );

    expect(data).toMatchObject({
      book: {
        id: bookWithRelated.id,
        title: bookWithRelated.attributes.title,
        author: { id: author.id, name: author.attributes.name },
      },
    });
  });

  it('handles empty included relationships', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const author = {
      id: '1',
      type: 'authors',
      attributes: { name: 'George R. R. Martin' },
      relationships: { books: { data: [] } },
    };

    fetchMock.get('/api/authors/1?include=books', {
      data: author,
    });

    const query = gql`
      query authorQuery {
        author @jsonapi(path: "/authors/1?include=books") {
          id
          books {
            id
            title
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'authorQuery',
        query,
      }),
    );

    expect(data).toMatchObject({
      author: {
        __typename: 'authors',
        id: author.id,
        books: [],
      },
    });
  });

  it('handles identifier objects in relationships', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const author = {
      id: '1',
      type: 'authors',
      attributes: { name: 'George R. R. Martin' },
      relationships: {
        books: { data: [{ id: '2', type: 'books' }] },
        photo: { data: { id: '3', type: 'photos' } },
      },
    };

    fetchMock.get('/api/authors/1', {
      data: author,
    });

    const query = gql`
      query authorQuery {
        author @jsonapi(path: "/authors/1") {
          id
          books {
            id
          }
          photo {
            id
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'authorQuery',
        query,
      }),
    );

    expect(data).toMatchObject({
      author: {
        __typename: 'authors',
        id: author.id,
        books: [{ id: '2' }],
        photo: { id: '3' },
      },
    });
  });

  it('ignores relationship and data links', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const author = {
      id: '1',
      type: 'authors',
      attributes: { name: 'George R. R. Martin' },
      links: { self: '/authors/1' },
    };
    const bookWithRelated = {
      id: '2',
      type: 'books',
      attributes: { title: 'A Game of Thrones' },
      links: { self: '/books/2' },
      relationships: {
        author: {
          data: { id: author.id, type: author.type },
          links: {
            self: '/books/2/relationships/author',
            related: '/books/2/author',
          },
        },
        series: {
          links: {
            self: '/books/2/relationships/series',
            related: '/books/2/series',
          },
        },
      },
    };

    fetchMock.get('/api/books/2?include=author', {
      data: bookWithRelated,
      included: [author],
    });

    const bookWithAuthorQuery = gql`
      query bookWithAuthor {
        book @jsonapi(path: "/books/2?include=author") {
          id
          title
          author {
            id
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'bookWithAuthor',
        query: bookWithAuthorQuery,
      }),
    );

    expect(data).toMatchObject({
      book: {
        id: bookWithRelated.id,
        title: bookWithRelated.attributes.title,
        author: { id: author.id, name: author.attributes.name },
      },
    });
  });

  it('can query through deeply nested and looping relationships', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });
    const book1 = {
      id: 'book1',
      type: 'books',
      attributes: { title: 'A Game of Thrones' },
      relationships: {
        author: { data: { id: 'author1', type: 'authors' } },
      },
    };
    const book6 = {
      id: 'book6',
      type: 'books',
      attributes: { title: 'The Winds of Winter' },
      relationships: {
        author: { data: { id: 'author2', type: 'authors' } },
      },
    };
    const series = {
      id: 'series1',
      type: 'series',
      attributes: {
        title: 'A Song of Ice and Fire',
      },
      relationships: {
        books: {
          data: [
            { id: book1.id, type: book1.type },
            { id: book6.id, type: book6.type },
          ],
        },
      },
    };
    const george = {
      id: 'author1',
      type: 'authors',
      attributes: { name: 'George R. R. Martin' },
      relationships: {
        series: { data: [{ id: series.id, type: series.type }] },
        books: {
          data: [{ id: book1.id, type: book1.type }],
        },
      },
    };
    const brandon = {
      id: 'author2',
      type: 'authors',
      attributes: { name: 'Brandon Sanderson' },
    };

    fetchMock.get('glob:/api/authors/1?include=*', {
      data: george,
      included: [brandon, book1, book6, series],
    });

    const complexRelationshipsQuery = gql`
      query complexRelationships {
        primaryAuthor
          @jsonapi(
            path: "/authors/1?include=books,series,series.books,series.books.author"
          ) {
          name
          books {
            title
          }
          series {
            title
            books {
              title
              author {
                name
              }
            }
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'complexRelationships',
        query: complexRelationshipsQuery,
      }),
    );

    expect(data).toMatchObject({
      primaryAuthor: {
        name: george.attributes.name,
        books: [{ title: book1.attributes.title }],
        series: [
          {
            title: series.attributes.title,
            books: [
              {
                title: book1.attributes.title,
                author: { name: george.attributes.name },
              },
              {
                title: book6.attributes.title,
                author: { name: brandon.attributes.name },
              },
            ],
          },
        ],
      },
    });
  });

  it('returns an empty object on 204 status', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    fetchMock.get('/api/no-content', {
      headers: { 'Content-Length': 0 },
      status: 204,
      body: { content: true },
    });

    const queryWithNoContent = gql`
      query noContent {
        noContentResponse @jsonapi(path: "/no-content") {
          content
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'noContent',
        query: queryWithNoContent,
      }),
    );

    expect(data).toMatchObject({
      noContentResponse: {},
    });
  });

  it('returns an error on unsuccessful gets with zero Content-Length', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    fetchMock.get('/api/no-content', {
      headers: { 'Content-Length': 0 },
      status: 400,
      body: { content: true },
    });

    const errorWithNoContent = gql`
      query noContent {
        noContentResponse @jsonapi(path: "/no-content") {
          content
        }
      }
    `;

    try {
      await makePromise<Result>(
        execute(link, {
          operationName: 'noContent',
          query: errorWithNoContent,
        }),
      );
    } catch (e) {
      expect(e).toEqual(
        new Error('Response not successful: Received status code 400'),
      );
    }
  });
});

describe('Use a custom pathBuilder', () => {
  afterEach(() => {
    fetchMock.restore();
  });
  it.skip('in a basic way', async () => {
    expect.assertions(4);

    const link = new JsonApiLink({ uri: '/api' });
    const posts1 = [{ id: '1', title: 'Love apollo' }];
    const posts2 = [{ id: '2', title: 'Love apollo' }];
    fetchMock.get('/api/posts?status=published', posts1);
    fetchMock.get('/api/posts?otherStatus=published', posts2);

    const postTitleQuery = gql`
      query postTitle(
        $pathFunction: any
        $status: String
        $otherStatus: String
      ) {
        posts(status: $status, otherStatus: $otherStatus)
          @jsonapi(type: "Post", pathBuilder: $pathFunction) {
          id
          title
        }
      }
    `;

    function createPostsPath({
      args,
      exportVariables,
    }: JsonApiLink.PathBuilderProps) {
      const variables = { ...args, ...exportVariables };
      const qs = Object.keys(variables).reduce(
        (acc: string, key: string): string => {
          if (variables[key] === null || variables[key] === undefined) {
            return acc;
          }
          if (acc === '') {
            return '?' + key + '=' + encodeURIComponent(String(variables[key]));
          }
          return (
            acc + '&' + key + '=' + encodeURIComponent(String(variables[key]))
          );
        },
        '',
      );

      // console.debug(variables, qs);
      return '/posts' + qs;
    }

    const { data: data1 } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
        variables: {
          status: 'published',
          pathFunction: createPostsPath,
        },
      }),
    );

    expect(data1).toMatchObject({
      posts: [{ ...posts1[0], __typename: 'Post' }],
    });

    // Extra tests below to disprove: https://github.com/apollographql/apollo-link-rest/issues/102
    const { data: data2 } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
        variables: {
          otherStatus: 'published',
          pathFunction: createPostsPath,
        },
      }),
    );

    expect(data2).toMatchObject({
      posts: [{ ...posts2[0], __typename: 'Post' }],
    });

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    const { data: data1b }: { data: any } = await client.query({
      query: postTitleQuery,
      variables: {
        status: 'published',
        pathFunction: createPostsPath,
      },
    });
    expect(data1b).toMatchObject({
      posts: [{ ...posts1[0], __typename: 'Post' }],
    });

    const { data: data2b }: { data: any } = await client.query({
      query: postTitleQuery,
      variables: {
        otherStatus: 'published',
        pathFunction: createPostsPath,
      },
    });
    expect(data2b).toMatchObject({
      posts: [{ ...posts2[0], __typename: 'Post' }],
    });
  });

  it.skip('with correctly encoded params', async () => {
    // expect.assertions(4);

    const link = new JsonApiLink({ uri: '/api' });
    const posts1 = [{ id: '1', title: 'Love apollo' }];
    // This is an invalid URL because it doesn't have an encoded space, this is to prove
    // we didn't encode it if it wasn't prefixed by '?' or '&' ?{args} or &{args}
    fetchMock.get('/api/posts?name=Love apollo', posts1);
    // This URL is legacy (shouldn't be called)
    fetchMock.get('/api/posts?name=Love+apollo', posts1);
    // This URL is correctly encoded
    fetchMock.get('/api/posts?name=Love%20apollo', posts1);
    // Uses a query string & a path replacement
    fetchMock.get('/api/posts/1?comments=5', posts1);

    const nonEncodedQuery = gql`
      query postQuery($name: String) {
        posts(name: $name)
          @jsonapi(type: "Post", path: "/posts?name={args.name}") {
          id
          title
        }
      }
    `;
    const encodedQuery = gql`
      query postQuery($name: String) {
        posts(name: $name) @jsonapi(type: "Post", path: "/posts?{args}") {
          id
          title
        }
      }
    `;
    const mixedQuery = gql`
      query postQuery($id: String, $query: Any) {
        posts(id: $id, query: $query)
          @jsonapi(type: "Post", path: "/posts/{args.id}?{args.query}") {
          id
          title
        }
      }
    `;

    await makePromise<Result>(
      execute(link, {
        operationName: 'postQuery',
        query: nonEncodedQuery,
        variables: { name: 'Love apollo' },
      }),
    );

    expect(fetchMock.called('/api/posts?name=Love apollo')).toBe(true);

    await makePromise<Result>(
      execute(link, {
        operationName: 'postQuery',
        query: encodedQuery,
        variables: { name: 'Love apollo' },
      }),
    );

    expect(fetchMock.called('/api/posts?name=Love%20apollo')).toBe(true);

    await makePromise<Result>(
      execute(link, {
        operationName: 'postQuery',
        query: mixedQuery,
        variables: { id: 1, query: { comments: 5 } },
      }),
    );

    expect(fetchMock.called('/api/posts/1?comments=5')).toBe(true);
  });
  // TODO: Test for Path using context
  // TODO: Test for PathBuilder using replacer
  // TODO: Test for PathBuilder using @jsonapi
});

describe('Query multiple calls', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can run a query with multiple rest calls', async () => {
    expect.assertions(2);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
    };
    fetchMock.get('/api/post/1', post);

    const tags = {
      data: [
        { type: 'tags', id: '1', attributes: { name: 'apollo' } },
        { type: 'tags', id: '2', attributes: { name: 'graphql' } },
      ],
    };
    fetchMock.get('/api/tags', tags);

    const postAndTags = gql`
      query postAndTags {
        post @jsonapi(path: "/post/1") {
          id
          title
        }
        tags @jsonapi(path: "/tags") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postAndTags',
        query: postAndTags,
      }),
    );

    expect(data.post).toBeDefined();
    expect(data.tags).toBeDefined();
  });

  it('can run a subquery with multiple jsonapi calls', async () => {
    expect.assertions(2);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
    };
    fetchMock.get('/api/post/1', post);

    const tags = {
      data: [
        { type: 'tags', id: '1', attributes: { name: 'apollo' } },
        { type: 'tags', id: '2', attributes: { name: 'graphql' } },
      ],
    };
    fetchMock.get('/api/tags', tags);

    const postAndTags = gql`
      query postAndTags {
        post @jsonapi(path: "/post/1") {
          id
          title
          tags @jsonapi(path: "/tags") {
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postAndTags',
        query: postAndTags,
      }),
    );

    expect(data.post).toBeDefined();
    expect(data.post.tags).toBeDefined();
  });

  it('can return a partial result if one out of multiple jsonapi calls fail', async () => {
    expect.assertions(2);

    const link = new JsonApiLink({ uri: '/api' });

    fetchMock.get('/api/post/1', {
      status: 404,
      body: { status: 'error', message: 'Not found' },
    });

    const tags = {
      data: [
        { type: 'tags', id: '1', attributes: { name: 'apollo' } },
        { type: 'tags', id: '2', attributes: { name: 'graphql' } },
      ],
    };
    fetchMock.get('/api/tags', tags);

    const postAndTags = gql`
      query postAndTags {
        post @jsonapi(path: "/post/1") {
          id
          title
        }
        tags @jsonapi(path: "/tags") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postAndTags',
        query: postAndTags,
      }),
    );

    expect(data.tags).toBeDefined();
    expect(data.post).toBeNull();
  });
});

describe('GraphQL aliases should work', async () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('outer-level aliases are supported', async () => {
    expect.assertions(2);

    const link = new JsonApiLink({ endpoints: { v1: '/v1', v2: '/v2' } });

    const postV1 = {
      data: { type: 'posts', id: '1', attributes: { title: '1. Love apollo' } },
    };
    const postV2 = {
      data: {
        type: 'posts',
        id: '1',
        attributes: { titleText: '2. Love apollo' },
      },
    };
    fetchMock.get('/v1/post/1', postV1);
    fetchMock.get('/v2/post/1', postV2);

    const postTitleQueries = gql`
      query postTitle($id: ID!) {
        v1: post(id: $id) @jsonapi(path: "/post/{args.id}", endpoint: "v1") {
          id
          title
        }
        v2: post(id: $id) @jsonapi(path: "/post/{args.id}", endpoint: "v2") {
          id
          titleText
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQueries,
        variables: { id: '1' },
      }),
    );

    expect(data.v1.title).toBe(postV1.data.attributes.title);
    expect(data.v2.titleText).toBe(postV2.data.attributes.titleText);
  });

  it('nested aliases are supported', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/v1' });

    const postV1 = {
      data: {
        type: 'posts',
        id: '1',
        attributes: { titleText: '1. Love apollo' },
      },
    };
    fetchMock.get('/v1/post/1', postV1);

    const postTitleQueries = gql`
      query postTitle($id: ID!) {
        post(id: $id) @jsonapi(path: "/post/{args.id}") {
          id
          title: titleText
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQueries,
        variables: { id: '1' },
      }),
    );

    expect(data.post.title).toBe(postV1.data.attributes.titleText);
  });
});

describe('Query options', () => {
  afterEach(() => {
    fetchMock.restore();
  });
  describe('credentials', () => {
    it('adds credentials to the request from the setup', async () => {
      expect.assertions(1);
      const link = new JsonApiLink({
        uri: '/api',
        // Casting to RequestCredentials for testing purposes,
        // the only valid values here defined by RequestCredentials from Fetch
        // and typescript will yell at you for violating this!
        credentials: 'my-credentials' as RequestCredentials,
      });

      const post = {
        data: { type: 'posts', id: '1', attributes: { Title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });

    it('adds credentials to the request from the context', async () => {
      expect.assertions(2);

      const credentialsMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          credentials: 'my-credentials',
        });
        return forward(operation).map(result => {
          const { credentials } = operation.getContext();
          expect(credentials).toBeDefined();
          return result;
        });
      });

      const link = ApolloLink.from([
        credentialsMiddleware,
        new JsonApiLink({ uri: '/api' }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });

    it('prioritizes context credentials over setup credentials', async () => {
      expect.assertions(2);

      const credentialsMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          credentials: 'my-credentials',
        });
        return forward(operation).map(result => {
          const { credentials } = operation.getContext();
          expect(credentials).toBeDefined();
          return result;
        });
      });

      const link = ApolloLink.from([
        credentialsMiddleware,
        new JsonApiLink({
          uri: '/api',
          credentials: 'wrong-credentials' as RequestCredentials,
        }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });

    it('sets the fetch responses on context.restResponses', async () => {
      expect.assertions(5);

      const credentialsMiddleware = new ApolloLink((operation, forward) => {
        return forward(operation).map(result => {
          const { restResponses } = operation.getContext();
          expect(restResponses).toHaveLength(2);
          expect(restResponses[0].url).toBe('/api/post/1');
          expect(restResponses[0].headers.get('Header1')).toBe('Header1');
          expect(restResponses[1].url).toBe('/api/tags');
          expect(restResponses[1].headers.get('Header2')).toBe('Header2');
          return result;
        });
      });

      const link = ApolloLink.from([
        credentialsMiddleware,
        new JsonApiLink({ uri: '/api' }),
      ]);

      const context: { restResponses?: Response[] } = {};

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', {
        body: post,
        headers: { Header1: 'Header1' },
      });

      const tags = {
        data: [
          { type: 'tags', id: '1', attributes: { name: 'apollo' } },
          { type: 'tags', id: '2', attributes: { name: 'graphql' } },
        ],
      };
      fetchMock.get('/api/tags', {
        body: tags,
        headers: { Header2: 'Header2' },
      });

      const postAndTags = gql`
        query postAndTags {
          post @jsonapi(type: "Post", path: "/post/1") {
            id
            title
            tags @jsonapi(type: "[Tag]", path: "/tags") {
              name
            }
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postAndTags',
          query: postAndTags,
          context,
        }),
      );
    });
  });

  describe('method', () => {
    it('works for GET requests', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}", method: "GET") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('works without specifying a request method', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(type: "Post", path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('headers', () => {
    it('sets the Accept: application/vnd.api+json header if not provided', async () => {
      expect.assertions(2);

      fetchMock.get('/api/posts', { data: [] });
      const postsQuery = gql`
        query posts {
          posts @jsonapi(path: "/posts") {
            id
          }
        }
      `;
      const operation = {
        operationName: 'posts',
        query: postsQuery,
      };

      const link1 = new JsonApiLink({ uri: '/api' });
      await makePromise<Result>(execute(link1, operation));

      const link2 = new JsonApiLink({
        uri: '/api',
        headers: {
          Accept: 'text/plain',
        },
      });
      await makePromise<Result>(execute(link2, operation));

      const requestCalls = fetchMock.calls('/api/posts');
      expect(orderDupPreservingFlattenedHeaders(requestCalls[0][1])).toEqual([
        'accept: application/vnd.api+json',
      ]);
      expect(orderDupPreservingFlattenedHeaders(requestCalls[1][1])).toEqual([
        'accept: text/plain',
      ]);
    });

    it('adds headers to the request from the context', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: { authorization: '1234' },
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new JsonApiLink({ uri: '/api' }),
      ]);

      const post = {
        type: 'posts',
        id: '1',
        attributes: { title: 'Love apollo' },
      };
      fetchMock.get('/api/post/1', { data: post });

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(orderDupPreservingFlattenedHeaders(requestCall[1])).toEqual([
        'accept: application/vnd.api+json',
        'authorization: 1234',
      ]);
    });

    it('adds headers to the request from the setup', async () => {
      const link = new JsonApiLink({
        uri: '/api',
        headers: { authorization: '1234' },
      });

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(type: "Post", path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect({ headers: flattenHeaders(requestCall[1]) }).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: '1234',
          }),
        }),
      );
    });

    it('prioritizes context headers over setup headers', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: {
            authorization: '1234',
            // won't be overridden, will be duplicated because of headersToOverride
            setup: 'in-context duplicate setup',
            context: 'context',
          },
          headersToOverride: ['authorization'],
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new JsonApiLink({
          uri: '/api',
          headers: { authorization: 'no user', setup: 'setup' },
        }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributres: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(orderDupPreservingFlattenedHeaders(requestCall[1])).toEqual([
        'accept: application/vnd.api+json',
        'authorization: 1234',
        'context: context',
        'setup: setup, in-context duplicate setup',
      ]);
    });

    it('respects context-provided header-merge policy', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        /** This Merge Policy preserves the setup headers over the context headers */
        const headersMergePolicy: JsonApiLink.HeadersMergePolicy = (
          ...headerGroups: Headers[]
        ) => {
          return headerGroups.reduce((accumulator, current) => {
            normalizeHeaders(current).forEach((value, key) => {
              if (!accumulator.has(key)) {
                accumulator.append(key, value);
              }
            });
            return accumulator;
          }, new Headers());
        };
        operation.setContext({
          headers: { authorization: 'context', context: 'context' },
          headersMergePolicy,
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new JsonApiLink({
          uri: '/api',
          headers: { authorization: 'initial setup', setup: 'setup' },
        }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect({ headers: flattenHeaders(requestCall[1]) }).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'initial setup',
            setup: 'setup',
            context: 'context',
          }),
        }),
      );
    });

    it('preserves duplicative headers in their correct order', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: { authorization: 'context' },
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new JsonApiLink({
          uri: '/api',
          headers: { authorization: 'initial setup' },
        }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      const { headers } = requestCall[1];
      const orderedFlattened = [];
      headers.forEach((value, key) => {
        orderedFlattened.push(`${key}: ${value}`);
      });
      expect(orderedFlattened).toEqual([
        'accept: application/vnd.api+json',
        'authorization: initial setup, context',
      ]);
    });

    it('generates a new headers object if headers are undefined', async () => {
      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: undefined,
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeUndefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new JsonApiLink({ uri: '/api', headers: undefined }),
      ]);

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @jsonapi(path: "/post/{args.id}") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(orderDupPreservingFlattenedHeaders(requestCall[1])).toEqual([
        'accept: application/vnd.api+json',
      ]);
    });
  });
});

describe('Mutation', () => {
  describe('basic support', () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it('supports POST requests', async () => {
      expect.assertions(2);

      const link = new JsonApiLink({ uri: '/api' });

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.post('/api/posts', post);
      const resultPost = { __typename: 'posts', id: '1', title: 'Love apollo' };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          title: String
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(path: "/posts", method: "POST") {
            id
            title
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: { title: post.data.attributes.title } },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('supports PUT requests', async () => {
      expect.assertions(2);

      const link = new JsonApiLink({ uri: '/api' });

      const post = {
        data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
      };
      fetchMock.put('/api/posts/1', post);
      const resultPost = { __typename: 'posts', id: '1', title: 'Love apollo' };

      const replacePostMutation = gql`
        fragment ReplaceablePostInput on REST {
          id: ID
          title: String
        }

        mutation changePost($id: ID!, $input: ReplaceablePostInput!) {
          replacedPost(id: $id, input: $input)
            @jsonapi(path: "/posts/{args.id}", method: "PUT") {
            id
            title
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'republish',
          query: replacePostMutation,
          variables: { id: post.data.id, input: post },
        }),
      );
      expect(response.data.replacedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('supports PATCH requests', async () => {
      expect.assertions(2);

      const link = new JsonApiLink({ uri: '/api' });

      const post = {
        data: {
          type: 'posts',
          id: '1',
          attributes: { title: 'Love apollo', categoryId: 6 },
        },
      };
      fetchMock.patch('/api/posts/1', post);
      const resultPost = {
        __typename: 'posts',
        id: '1',
        title: 'Love apollo',
        categoryId: 6,
      };

      const editPostMutation = gql`
        fragment PartialPostInput on REST {
          id: ID
          title: String
          categoryId: Number
        }

        mutation editPost($id: ID!, $input: PartialPostInput!) {
          editedPost(id: $id, input: $input)
            @jsonapi(path: "/posts/{args.id}", method: "PATCH") {
            id
            title
            categoryId
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'editPost',
          query: editPostMutation,
          variables: {
            id: post.data.id,
            input: { categoryId: post.data.attributes.categoryId },
          },
        }),
      );
      expect(response.data.editedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('supports DELETE requests', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      fetchMock.delete('/api/posts/1', { status: 204 });

      const deletePostMutation = gql`
        mutation deletePost($id: ID!) {
          deletePostResponse(id: $id)
            @jsonapi(path: "/posts/{args.id}", method: "DELETE") {
            NoResponse
          }
        }
      `;
      await makePromise<Result>(
        execute(link, {
          operationName: 'deletePost',
          query: deletePostMutation,
          variables: { id: 1 },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('empty response bodies', () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it.skip('returns an empty object on 204 status', async () => {
      // In truth this test is just for show, because the fetch implementation
      // used in the tests already returns {} from res.json() for 204 responses
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts', {
        status: 204,
        body: post,
      });

      const createPostMutation = gql`
        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(type: "Post", path: "/posts", method: "POST") {
            id
            title
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: {
              data: { type: 'posts', attributes: { title: post.title } },
            },
          },
        }),
      );

      expect(response.data.publishedPost).toEqual({
        __typename: 'Post',
        id: null,
        title: null,
      });
    });

    it.skip('returns an empty object on successful posts with zero Content-Length', async () => {
      // In Node.js parsing an empty body doesn't throw an error, so the best test is
      // to provide body data and ensure the zero length still triggers the empty response
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });
      const post = { id: '1', title: 'Love apollo' };

      fetchMock.post('/api/posts', {
        headers: { 'Content-Length': 0 },
        body: post,
      });

      const createPostMutation = gql`
        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(type: "Post", path: "/posts", method: "POST") {
            id
            title
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: {
              data: { type: 'posts', attributes: { title: post.title } },
            },
          },
        }),
      );

      expect(response.data.publishedPost).toEqual({
        __typename: 'Post',
        id: null,
        title: null,
      });
    });

    it('returns an error on unsuccessful posts with zero Content-Length', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      fetchMock.post('/api/posts', {
        headers: { 'Content-Length': 0 },
        status: 400,
      });

      const createPostMutation = gql`
        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(path: "/posts", method: "POST") {
            title
          }
        }
      `;

      try {
        await makePromise<Result>(
          execute(link, {
            operationName: 'publishPost',
            query: createPostMutation,
            variables: {
              input: { data: { type: 'posts', attributes: { title: null } } },
            },
          }),
        );
      } catch (e) {
        expect(e).toEqual(
          new Error('Response not successful: Received status code 400'),
        );
      }
    });

    it('returns an error on zero Content-Length but status > 300', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts', {
        headers: { 'Content-Length': 0 },
        status: 500,
        body: post,
      });

      const createPostMutation = gql`
        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(path: "/posts", method: "POST") {
            id
            title
          }
        }
      `;
      return await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: {
              data: { type: 'posts', attributes: { title: post.title } },
            },
          },
        }),
      ).catch(e =>
        expect(e).toEqual(
          new Error('Response not successful: Received status code 500'),
        ),
      );
    });
  });

  describe('fieldNameDenormalizer', () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it('corrects names to decamelize for link-level denormalizer', async () => {
      expect.assertions(3);

      const link = new JsonApiLink({
        uri: '/api',
        fieldNameNormalizer: name => camelize(name),
        fieldNameDenormalizer: name => decamelize(name),
      });

      const snakePost = { title_string: 'Love apollo', category_id: 6 };
      fetchMock.post('/api/posts', {
        data: {
          id: '1',
          type: 'posts',
          attributes: snakePost,
        },
      });
      const camelPost = { titleString: 'Love apollo', categoryId: 6 };

      const createPostMutation = gql`
        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(path: "/posts", method: "POST") {
            id
            titleString
            categoryId
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: { data: { type: 'posts', attributes: camelPost } },
          },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts')[0];

      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(JSON.parse(requestCall[1].body)).toMatchObject({
        data: {
          type: 'posts',
          attributes: snakePost,
        },
      });

      expect(response.data.publishedPost).toEqual(
        expect.objectContaining({ ...camelPost, id: '1', __typename: 'posts' }),
      );
    });

    it('corrects names to decamelize for request-level denormalizer', async () => {
      expect.assertions(3);

      const link = new JsonApiLink({
        uri: '/api',
        fieldNameNormalizer: camelize,
      });

      const snakePost = { title_string: 'Love apollo', category_id: 6 };
      const camelPost = { titleString: 'Love apollo', categoryId: 6 };
      fetchMock.post('/api/posts', {
        data: { type: 'posts', id: 1, attributes: snakePost },
      });
      const resultPost = { __typename: 'posts', id: 1, ...camelPost };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          titleString: String
          categoryId: Int
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(
              path: "/posts"
              method: "POST"
              fieldNameDenormalizer: $requestLevelDenormalizer
            ) {
            id
            titleString
            categoryId
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: { data: { type: 'posts', attributes: camelPost } },
            requestLevelDenormalizer: decamelize,
          },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts')[0];

      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(JSON.parse(requestCall[1].body)).toMatchObject({
        data: {
          type: 'posts',
          attributes: snakePost,
        },
      });

      expect(response.data.publishedPost).toEqual(
        expect.objectContaining(resultPost),
      );
    });
  });

  describe('bodyKey/bodyBuilder', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it.skip("if using the regular JSON bodyBuilder it doesn't stack multiple content-type headers", async () => {
      const CUSTOM_JSON_CONTENT_TYPE = 'my-custom-json-ish-content-type';

      const link = new JsonApiLink({
        uri: '/api',
        headers: { 'Content-Type': CUSTOM_JSON_CONTENT_TYPE },
      });
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
            ) {
            id
            title
            items
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );
      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1].headers.get('content-type')).toEqual(
        CUSTOM_JSON_CONTENT_TYPE,
      );
    });
    it.skip('builds request body containing Strings/Objects/Arrays types without changing their types', async () => {
      // tests convertObjectKeys functionality
      // see: https://github.com/apollographql/apollo-link-rest/issues/45
      expect.assertions(3);

      const link = new JsonApiLink({ uri: '/api' });

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
            ) {
            id
            title
            items
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(JSON.stringify(post));
    });

    it.skip('respects bodyBuilder for mutations', async () => {
      expect.assertions(2);

      const link = new JsonApiLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts/new', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          title: String
        }

        mutation publishPost(
          $input: PublishablePostInput!
          $customBuilder: any
        ) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/new"
              method: "POST"
              bodyBuilder: $customBuilder
            ) {
            id
            title
          }
        }
      `;
      function fakeEncryption({ args }: JsonApiLink.JsonApiLinkHelperProps) {
        return 'MAGIC_PREFIX' + JSON.stringify(args.input);
      }

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: { title: post.title },
            customBuilder: fakeEncryption,
          },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/new')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(
            fakeEncryption({
              args: { input: { title: post.title } },
              exportVariables: {},
              context: {},
              '@jsonapi': {},
            }),
          ),
        }),
      );
    });
    it.skip('builds a request body for query operations', async () => {
      expect.assertions(3);

      const link = new JsonApiLink({ uri: '/api' });
      const post = { id: '1', title: 'This does not feel very RESTful.' };
      const resultPost = { __typename: 'Post', ...post };
      fetchMock.post('/api/post-to-get-post', post);

      const getPostQuery = gql`
        query getPost($id: ID!) {
          post(input: { id: $id })
            @jsonapi(type: "Post", path: "/post-to-get-post", method: "POST") {
            id
            title
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'getPost',
          query: getPostQuery,
          variables: { id: '1' },
        }),
      );

      expect(response.data.post).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/post-to-get-post')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(JSON.stringify({ id: '1' }));
    });

    it.skip('throws when no body input is provided for HTTP methods other than GET or DELETE', async () => {
      expect.assertions(1);

      const link = new JsonApiLink({ uri: '/api' });

      const createPostMutation = gql`
        mutation createPost {
          sendPost @jsonapi(type: "Post", path: "/posts/new", method: "POST") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'createPost',
          query: createPostMutation,
        }),
      ).catch(e =>
        expect(e).toEqual(
          new Error(
            '[GraphQL POST mutation using a REST call without a body]. No `input` was detected. Pass bodyKey, or bodyBuilder to the @jsonapi() directive to resolve this.',
          ),
        ),
      );
    });
    // TODO: Test for BodyBuilder using context
    // TODO: Test for BodyBuilder using @jsonapi
  });

  describe('bodySerializer', () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it.skip('defaults to json serialization for objects', async () => {
      expect.assertions(2);

      const link = new JsonApiLink({ uri: '/api' });

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
            ) {
            id
            title
            items
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(JSON.stringify(post));
    });

    it.skip('respects custom body serializers keys', async () => {
      expect.assertions(3);

      // A custom serializer that always returns the same value
      const constSerializer = () => ({
        body: 42,
        headers: { 'Content-Type': 'text/plain' },
      });

      const link = new JsonApiLink({
        uri: '/api',
        bodySerializers: {
          const: constSerializer,
        },
      });

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost(
          $input: PublishablePostInput!
          $bodySerializer: any
        ) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
              bodySerializer: "const"
            ) {
            id
            title
            items
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(42);
      expect({ headers: flattenHeaders(requestCall[1]) }).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'content-type': 'text/plain',
          }),
        }),
      );
    });

    it.skip('respects custom body serializers', async () => {
      expect.assertions(4);

      // A custom serializer that always returns the same value
      const constSerializer = (_, headers) => ({ body: 42, headers });

      const link = new JsonApiLink({
        uri: '/api',
        bodySerializers: {
          fake: (data, headers) => ({
            body: { ...data, isFake: true },
            headers,
          }),
        },
      });

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost(
          $input: PublishablePostInput!
          $bodySerializer: any
        ) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
              bodySerializer: $bodySerializer
            ) {
            id
            title
            items
          }
          fakePublishedPost: publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
              bodySerializer: "fake"
            ) {
            id
            title
            items
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post, bodySerializer: constSerializer },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(42);

      const secondRequestCall = fetchMock.calls('/api/posts/newComplexPost')[1];
      expect(secondRequestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(secondRequestCall[1].body).toEqual(
        expect.objectContaining({ isFake: true }),
      );
    });

    it.skip('returns the original object if the body serializers have a File or FileList object', async () => {
      expect.assertions(3);
      const link = new JsonApiLink({
        uri: '/api',
        bodySerializers: {
          upFiles: (body, headers) => ({
            body,
            headers,
          }),
        },
      });

      // define a File object
      const file = new File(['Love apollo'], 'apollo.txt', {
        type: 'text/plain',
      });
      //mocking FileList object
      const mockFileList = Object.create(FileList.prototype);
      Object.defineProperty(mockFileList, 'item', {
        value: function(number: number) {
          return mockFileList[number];
        },
        writable: false,
        enumerable: true,
        configurable: false,
      });
      Object.defineProperty(mockFileList, 'length', {
        value: 1,
        writable: false,
        enumerable: true,
        configurable: false,
      });
      mockFileList[0] = file;

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
        attachments: mockFileList,
        cover: file,
      };

      fetchMock.post('/api/posts/newComplexPost', post);

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
          cover: File
          attachment: FileList
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @jsonapi(
              type: "Post"
              path: "/posts/newComplexPost"
              method: "POST"
              bodySerializer: "upFiles"
            ) {
            id
            title
            items
            cover
            attachments
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(
        expect.objectContaining({ cover: file }),
      );
      expect(requestCall[1].body).toEqual(
        expect.objectContaining({ attachments: mockFileList }),
      );
    });

    it.skip('throws if there is no custom serializer defined', () => {
      expect.assertions(1);
      const link = new JsonApiLink({
        uri: '/api',
      });

      const createPostMutation = gql`
        mutation CreatePost($input: any!) {
          createPost(input: $input)
            @jsonapi(
              type: "Post"
              method: "POST"
              path: "/posts/createPost"
              bodySerializer: "missing"
            ) {
            id
          }
        }
      `;

      const post = { id: '1' };

      return makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      ).catch(e =>
        expect(e).toEqual(
          new Error(
            '"bodySerializer" must correspond to configured serializer. Please make sure to specify a serializer called missing in the "bodySerializers" property of the JsonApiLink.',
          ),
        ),
      );
    });
  });
});

describe('validateRequestMethodForOperationType', () => {
  describe('for operation type "mutation"', () => {
    it('throws because it is not supported yet', () => {
      expect.assertions(1);
      expect(() =>
        validateRequestMethodForOperationType('GIBBERISH', 'mutation'),
      ).toThrowError('"mutation" operations do not support that HTTP-verb');
    });
  });
  describe('for operation type "subscription"', () => {
    it('throws because it is not supported yet', () => {
      expect.assertions(1);
      expect(() =>
        validateRequestMethodForOperationType('GET', 'subscription'),
      ).toThrowError('A "subscription" operation is not supported yet.');
    });
  });
});

describe('Apollo client integration', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can integrate with apollo client', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
    };
    fetchMock.get('/api/post/1', post);

    const postTagExport = gql`
      query {
        post @jsonapi(path: "/post/1") {
          id
          title
        }
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    const { data }: { data: any } = await client.query({
      query: postTagExport,
    });

    expect(data.post).toBeDefined();
  });

  it('has an undefined body on GET requests', async () => {
    expect.assertions(1);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      data: { type: 'posts', id: '1', attributes: { title: 'Love apollo' } },
    };
    fetchMock.get('/api/post/1', post);

    const postTagExport = gql`
      query {
        post @jsonapi(path: "/post/1") {
          id
          title
        }
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    await client.query({
      query: postTagExport,
    });

    expect(fetchMock.lastCall()[1].body).toBeUndefined();
  });

  it('treats absent response fields as optional', async () => {
    expect.assertions(2);

    const link = new JsonApiLink({ uri: '/api' });

    const post = {
      data: {
        type: 'posts',
        id: '1',
        attributes: {
          title: 'Love apollo',
          content: 'Best graphql client ever.',
        },
      },
    };
    const comments = {
      data: [
        {
          type: 'comments',
          id: 'c.12345',
          attributes: { text: 'This is great.' },
        },
      ],
    };
    fetchMock.get('/api/post/1', post);
    fetchMock.get('/api/post/1/comments', comments);

    const postTitleQuery = gql`
      query postTitle {
        post @jsonapi(path: "/post/1") {
          id
          title
          unfairCriticism
          comments @jsonapi(path: "/post/1/comments") {
            id
            text
            spammyContent
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postWithContent',
        query: postTitleQuery,
      }),
    );

    expect(data.post.unfairCriticism).toBeNull();

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    const { data: data2 }: { data: any } = await client.query({
      query: postTitleQuery,
    });
    expect(data2.post.unfairCriticism).toBeNull();
  });

  it('can catch HTTP Status errors', async done => {
    const link = new JsonApiLink({ uri: '/api' });

    const status = 403;

    // setup onError link
    const errorLink = onError(opts => {
      const { networkError } = opts;
      if (networkError != null) {
        //console.debug(`[Network error]: ${networkError}`);
        const { statusCode } = networkError as JsonApiLink.ServerError;
        expect(statusCode).toEqual(status);
      }
    });
    const combinedLink = ApolloLink.from([errorLink, link]);

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: combinedLink,
    });

    fetchMock.mock('/api/post/1', {
      status,
      body: { data: { type: 'posts', id: 1, attributes: {} } },
    });

    try {
      await client.query({
        query: sampleQuery,
      });
      done.fail('query should throw a network error');
    } catch (error) {
      done();
    }
  });

  it('supports being cancelled and does not throw', done => {
    class AbortError extends Error {
      constructor(message) {
        super(message);
        this.name = message;
      }
    }
    const customFetch = () =>
      new Promise((_, reject) => {
        reject(new AbortError('AbortError'));
      });

    const link = new JsonApiLink({
      uri: '/api',
      customFetch: customFetch as any,
    });

    const sub = execute(link, { query: sampleQuery }).subscribe({
      next: () => {
        done.fail('result should not have been called');
      },
      error: e => {
        done.fail(e);
      },
      complete: () => {
        done.fail('complete should not have been called');
      },
    });

    setTimeout(() => {
      sub.unsubscribe();
      done();
    }, 0);
  });
});

describe('Playing nice with others', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  function buildLinks() {
    const jsonApiLink = new JsonApiLink({ uri: '/api' });
    const httpLink = new HttpLink({ uri: '/graphql' });
    const clientLink = withClientState({
      cache: new InMemoryCache(),
      defaults: {
        lastViewedAuthor: {
          __typename: 'Author',
          id: 2,
        },
      },
      resolvers: {
        Query: {
          lastViewedAuthor() {
            return { id: 2, __typename: 'Author' };
          },
        },
      },
    });

    return { jsonApiLink, httpLink, clientLink };
  }

  const posts = [
    {
      id: '1',
      type: 'posts',
      attributes: { title: 'Love apollo' },
    },
    {
      id: '2',
      type: 'posts',
      attributes: { title: 'Respect apollo', meta: { creatorId: 1 } },
    },
  ];
  const authors = { data: { authors: [{ id: 1 }, { id: 2 }, { id: 3 }] } };
  const authorErrors = {
    errors: {
      authors: { message: 'Your query was bad and you should feel bad!' },
    },
  };

  it('should work alongside apollo-link-http', async () => {
    fetchMock.get('/api/posts', { data: posts });
    fetchMock.post('/graphql', authors);
    const { jsonApiLink, httpLink } = buildLinks();
    const link = from([jsonApiLink, httpLink]);
    const restQuery = gql`
      query {
        posts @jsonapi(path: "/posts") {
          title
        }
      }
    `;
    const httpQuery = gql`
      query {
        authors {
          id
        }
      }
    `;
    const combinedQuery = gql`
      query {
        authors {
          id
        }
        people @jsonapi(path: "/posts") {
          title
        }
      }
    `;
    const { data: restData } = await makePromise<Result>(
      execute(link, { operationName: 'restQuery', query: restQuery }),
    );
    const { data: httpData } = await makePromise<Result>(
      execute(link, { operationName: 'httpData', query: httpQuery }),
    );
    const { data: combinedData } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );
    expect(restData).toEqual({
      posts: [
        { title: 'Love apollo', __typename: 'posts' },
        { title: 'Respect apollo', __typename: 'posts' },
      ],
    });
    expect(httpData).toEqual({ authors: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    expect(combinedData).toEqual({
      people: [
        { title: 'Love apollo', __typename: 'posts' },
        { title: 'Respect apollo', __typename: 'posts' },
      ],
      authors: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
  });

  // this relies on the removed export feature, leaving skipped for now
  it.skip('should work nested in apollo-link-http', async () => {
    fetchMock.get('/api/posts/1', [posts[0]]);
    fetchMock.get('/api/posts/2', [posts[1]]);
    fetchMock.get('/api/posts/3', []);
    fetchMock.post('/graphql', authors);

    const { jsonApiLink, httpLink } = buildLinks();
    const link = from([jsonApiLink, httpLink]);

    const combinedQuery = gql`
      query {
        authors {
          id @export(as: "id")
          posts @jsonapi(type: "[Post]", path: "/posts/{exportVariables.id}") {
            title
          }
        }
      }
    `;

    const { data: combinedData } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );

    expect(combinedData).toEqual({
      authors: [
        {
          id: 1,
          posts: [{ title: 'Love apollo', __typename: 'post' }],
        },
        {
          id: 2,
          posts: [{ title: 'Respect apollo', __typename: 'post' }],
        },
        {
          id: 3,
          posts: [],
        },
      ],
    });
  });

  it('should forward errors from apollo-link-http', async () => {
    fetchMock.get('/api/posts', { data: posts });
    fetchMock.post('/graphql', authorErrors);
    const { jsonApiLink, httpLink } = buildLinks();
    const link = from([jsonApiLink, httpLink]);

    const combinedQuery = gql`
      query {
        authors {
          id
        }
        people @jsonapi(path: "/posts") {
          title
        }
      }
    `;

    const { data: combinedData, errors } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );

    expect(combinedData).toEqual({
      people: [
        { title: 'Love apollo', __typename: 'posts' },
        { title: 'Respect apollo', __typename: 'posts' },
      ],
    });

    expect(errors).toEqual({
      authors: { message: 'Your query was bad and you should feel bad!' },
    });
  });

  it('should work alongside apollo-link-state', async () => {
    fetchMock.get('/api/posts', { data: posts });
    const { jsonApiLink, clientLink } = buildLinks();
    // TODO Investigate why this order can't be swapped because client seems to strip the __typename field.
    const link = from([jsonApiLink, clientLink]);

    const combinedQuery = gql`
      query {
        lastViewedAuthor @client {
          id
        }
        posts @jsonapi(path: "/posts") {
          title
        }
      }
    `;

    const { data: combinedData } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );
    expect(combinedData).toEqual({
      posts: [
        { title: 'Love apollo', __typename: 'posts' },
        { title: 'Respect apollo', __typename: 'posts' },
      ],
      lastViewedAuthor: {
        id: 2,
      },
    });
  });

  it('should work nested in apollo-link-state', async () => {
    fetchMock.get('/api/posts', { data: posts });
    const { jsonApiLink, clientLink } = buildLinks();
    // TODO Investigate why this order can't be swapped because client seems to strip the __typename field.
    const link = from([jsonApiLink, clientLink]);

    const combinedQuery = gql`
      query {
        lastViewedAuthor @client {
          id
          people @jsonapi(path: "/posts") {
            title
          }
        }
      }
    `;

    const { data: combinedData } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );
    expect(combinedData).toEqual({
      lastViewedAuthor: {
        id: 2,
        people: [
          { title: 'Love apollo', __typename: 'posts' },
          { title: 'Respect apollo', __typename: 'posts' },
        ],
      },
    });
  });

  // this relies on the removed exports feature
  it.skip('should work with several layers of nesting', async () => {
    fetchMock.get('/api/posts/1', [posts[0]]);
    fetchMock.get('/api/posts/2', [posts[1]]);
    fetchMock.get('/api/posts/3', []);
    fetchMock.post('/graphql', authors);
    const { clientLink, jsonApiLink, httpLink } = buildLinks();

    const link = from([jsonApiLink, clientLink, httpLink]);

    const combinedQuery = gql`
      query {
        authors {
          id
          lastViewedAuthor @client {
            id @export(as: "id")
            posts
              @jsonapi(type: "[Post]", path: "/posts/{exportVariables.id}") {
              title
              meta @type(name: "Meta") {
                creatorId
              }
            }
          }
        }
      }
    `;

    const { data: combinedData } = await makePromise<Result>(
      execute(link, { operationName: 'combinedQuery', query: combinedQuery }),
    );

    expect(combinedData).toEqual({
      authors: [
        {
          id: 1,
          lastViewedAuthor: {
            id: 2,
            posts: [
              {
                __typename: 'Post',
                meta: { __typename: 'Meta', creatorId: 1 },
                title: 'Respect apollo',
              },
            ],
          },
        },
        {
          id: 2,
          lastViewedAuthor: {
            id: 2,
            posts: [
              {
                __typename: 'Post',
                meta: { __typename: 'Meta', creatorId: 1 },
                title: 'Respect apollo',
              },
            ],
          },
        },
        {
          id: 3,
          lastViewedAuthor: {
            id: 2,
            posts: [
              {
                __typename: 'Post',
                meta: { __typename: 'Meta', creatorId: 1 },
                title: 'Respect apollo',
              },
            ],
          },
        },
      ],
    });
  });
});
