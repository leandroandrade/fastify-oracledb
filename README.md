# fastify-oracledb
[![Greenkeeper badge](https://badges.greenkeeper.io/leandroandrade/fastify-oracledb.svg)](https://greenkeeper.io/)

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![Build Status](https://travis-ci.org/leandroandrade/fastify-oracledb.svg?branch=master)](https://travis-ci.org/leandroandrade/fastify-oracledb) [![Coverage Status](https://coveralls.io/repos/github/leandroandrade/fastify-oracledb/badge.svg?branch=master)](https://coveralls.io/github/leandroandrade/fastify-oracledb?branch=master)

This module provides access to an Oracle database connection pool via the
[oracledb](https://npm.im/oracledb) module. It decorates the [Fastify](https://fastify.io)
instance with an `oracle` property that is a connection pool instance.

When the Fastify server is shutdown, this plugin invokes the `.close()` method
on the connection pool.

## Install
```
npm i fastify-oracledb --save
```

## Usage
Add it to you project with `register` and you are done!
This plugin will add the `oracle` namespace in your Fastify instance, with the following properties:
```
getConnection: the function to get a connection from the pool
pool: the pool instance
query: a utility to perform a query _without_ a transaction
transact: a utility to perform multiple queries _with_ a transaction
```

## Examples

The plugin provides the basic functionality for creating a connection and executing statements such as

```js
const fastify = require('fastify')()

fastify.register(require('fastify-oracledb'), {
  pool: {
    user: 'foo',
    password: 'bar',
    connectString: 'oracle.example.com:1521/foobar'
  }
})

fastify.get('/db_data', async function (req, reply) {
  let connection
  try {
    connection = await this.oracle.getConnection()
    const { rows } = await connection.execute('SELECT 1 AS FOO FROM DUAL')
    return rows
  } finally {
    if (connection) await connection.close()
  }
})

fastify.listen(3000, (err) => {
  if (err) {
    fastify.log.error(err)
    // Manually close since Fastify did not boot correctly.
    fastify.close(err => {
      process.exit(1)
    })
  }

  // Initiate Fastify's shutdown procedure so that the plugin will
  // automatically close the connection pool.
  process.on('SIGTERM', fastify.close.bind(fastify))
})
```

The `query` feature can be used for convenience to perform a query _without_ a transaction

```js
const fastify = require('fastify')

fastify.register(require('fastify-oracledb'), {
  pool: {
    user: 'travis',
    password: 'travis',
    connectString: 'localhost/xe'
  } 
})

fastify.post('/user/:username', (req, reply) => {
  // will return a promise, fastify will send the result automatically
  return fastify.oracle.query('SELECT * FROM USERS WHERE NAME = :name', { name: 'james' })
})

/* or with a callback

fastify.oracle.query('SELECT * FROM USERS', function onResult (err, result) {
  reply.send(err || result)
})

*/
```
See [node-oracledb](https://oracle.github.io/node-oracledb/doc/api.html#-426-connectionexecute) documentation for all available usage options.

The `transact` feature can be used for convenience to perform multiple queries _with_ a transaction

```js
const fastify = require('fastify')

fastify.register(require('fastify-oracledb'), {
  pool: {
    user: 'travis',
    password: 'travis',
    connectString: 'localhost/xe'
  } 
})

fastify.post('/user/:username', (req, reply) => {
  // will return a promise, fastify will send the result automatically
  return fastify.oracle.transact(async conn => {
    // will resolve to commit, or rollback with an error
    return conn.execute(`INSERT INTO USERS (NAME) VALUES('JIMMY')`)
  })
})

/* or with a callback

fastify.oracle.transact(conn => {
    return conn.execute('SELECT * FROM DUAL')
  },
  function onResult (err, result) {
    reply.send(err || result)
  }
})

*/

/* or with a commit callback

fastify.oracle.transact((conn, commit) => {
  conn.execute('SELECT * FROM DUAL', (err, res) => {
    commit(err, res)
  });
})

*/

```

## Options

`fastify-oracledb` requires an options object with at least one of the following
properties:

- `pool`: an `oracledb` [pool configuration object](https://github.com/oracle/node-oracledb/blob/33331413/doc/api.md#createpool)
- `poolAlias`: the name of a pool alias that has already been configured. This
takes precedence over the `pool` option.
- `client`: an instance of an `oracledb` connection pool. This takes precedence
over the `pool` and `poolAlias` options.

Other options are as follows

- `name`: (optional) can be used in order to connect to multiple oracledb instances. The first registered instance can be accessed via `fastify.oracle` or `fastify.oracle.<dbname>`. Note that once you register a *named* instance, you will *not* be able to register an unnamed instance.
- `outFormat`: (optional) sets the `outFormat` of oracledb. Should be `'ARRAY'` or `'OBJECT'`. Default: `'ARRAY'`
- `fetchAsString`: (optional) the column data of specified types are returned as a string instead of the default representation. Should be an array of valid data types. 
Valid values are `['DATE', 'NUMBER', 'BUFFER', 'CLOB']`. Default `[]`.


```js
const fastify = require('fastify')()

fastify
  .register(require('fastify-oracledb'), {
    pool: {
      user: 'foo',
      password: 'bar',
      connectString: 'oracle.example.com:1521/ora1'
    },
    name: 'ora1'
  })
  .register(require('fastify-oracledb'), {
    pool: {
      user: 'foo',
      password: 'bar',
      connectString: 'oracle.example.com:1521/ora2'
    },
    name: 'ora2'
  })

fastify.get('/db_1_data', async function (req, reply) {
  let conn
  try {
    conn = await this.oracle.ora1.getConnection()
    const result = await conn.execute('select 1 as foo from dual')  
    return result.rows
  } finally {
    if (conn) {
      conn.close().catch((err) => {})
    }
  } 
})

fastify.get('/db_2_data', async function (req, reply) {
  let conn
  try {
    conn = await this.oracle.ora2.getConnection()
    const result = await conn.execute('select 1 as foo from dual')  
    return result.rows
  } finally {
    if (conn) {
      conn.close().catch((err) => {})
    }
  }
})
```

The `oracledb` instance is also available via `fastify.oracle.db` for accessing constants and other functionality:

```js
fastify.get('/db_data', async function (req, reply) {
  let conn
  try {
    conn = await this.oracle.ora1.getConnection()
    const result = await conn.execute('select 1 as foo from dual', { }, { outFormat: this.oracle.db.OBJECT })
    return result.rows
  } finally {
    if (conn) {
      conn.close().catch((err) => {})
    }
  } 
})
```

If needed `pool` instance can be accessed via `fastify.oracle[.dbname].pool`

## License

[MIT License](http://jsumners.mit-license.org/)

