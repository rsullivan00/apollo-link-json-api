# Change log

## Versions

### v0.0.1

* First publish

### v0.0.2

* Add support for `typeNameNormalizer`.
* Removes default `pascalize` of JSON API `type` -> GraphQL `__typename`
    conversion.

### v0.0.3

* Improves 204 handling so that Apollo doesn't complain about `__typename`
    missing.
