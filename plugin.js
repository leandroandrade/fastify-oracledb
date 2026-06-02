'use strict'

const fp = require('fastify-plugin')
const oracledb = require('oracledb')

function transactScope (pool, fn, cb) {
  pool.getConnection(function (err, conn) {
    if (err) return cb(err)

    const commit = (err, res) => {
      if (err) return conn.close(() => cb(err))

      conn.commit(function (err) {
        conn.close(function () {
          if (err) {
            return cb(err)
          }
          return cb(null, res)
        })
      })
    }

    const promise = fn(conn, commit)

    if (promise && typeof promise.then === 'function') {
      promise.then(
        (res) => commit(null, res),
        (e) => commit(e))
    }
  })
}

function transact (fn, cb) {
  if (cb && typeof cb === 'function') {
    return transactScope(this, fn, cb)
  }

  return new Promise((resolve, reject) => {
    transactScope(this, fn, function (err, res) {
      if (err) { return reject(err) }
      return resolve(res)
    })
  })
}

function execute (pool, sql, values, options, cb) {
  pool.getConnection(function (err, conn) {
    if (err) return cb(err)

    const done = (err, res) => {
      if (err) return conn.close(() => cb(err))

      conn.close(function () {
        return cb(null, res)
      })
    }

    conn.execute(sql, values, options, done)
  })
}

function query (sql, a2, a3, a4) {
  const promisify = typeof arguments[arguments.length - 1] !== 'function'

  let cb
  let values = []
  let options = {}

  switch (arguments.length) {
    case 2:
      promisify ? values = a2 : cb = a2
      break
    case 3:
      values = a2
      promisify ? options = a3 : cb = a3
      break
    case 4:
      values = a2
      options = a3
      cb = a4
      break
  }

  if (cb && typeof cb === 'function') {
    return execute(this, sql, values, options, cb)
  }

  return new Promise((resolve, reject) => {
    execute(this, sql, values, options, function (err, res) {
      if (err) { return reject(err) }
      return resolve(res)
    })
  })
}

function decorateFastifyInstance (pool, fastify, options) {
  const oracle = {
    getConnection: pool.getConnection.bind(pool),
    pool,
    query: query.bind(pool),
    transact: transact.bind(pool)
  }

  if (options.name) {
    if (!fastify.oracle) {
      fastify.decorate('oracle', Object.assign(oracle, { db: oracledb }))
    }

    if (fastify.oracle[options.name]) {
      throw new Error(`fastify-oracledb: connection name "${options.name}" has already been registered`)
    }

    fastify.oracle[options.name] = oracle
  } else {
    if (fastify.oracle) {
      throw new Error('fastify-oracledb has already been registered')
    } else {
      fastify.decorate('oracle', Object.assign(oracle, { db: oracledb }))
    }
  }

  fastify.addHook('onClose', async () => {
    if (options.drainTime != null) {
      await pool.close(options.drainTime)
    } else {
      await pool.close()
    }
  })
}

async function fastifyOracleDB (fastify, options) {
  if (options.client) {
    if (!(options.client instanceof oracledb.Pool)) {
      throw new Error('fastify-oracledb: supplied client must be an instance of oracledb.pool')
    }
    decorateFastifyInstance(options.client, fastify, options)
    return
  }

  if (options.poolAlias) {
    let pool
    try {
      pool = oracledb.getPool(options.poolAlias) // synchronous, throws error
    } catch (err) {
      throw new Error('fastify-oracledb: could not get pool alias-' + err.message)
    }
    decorateFastifyInstance(pool, fastify, options)
    return
  }

  if (!options.pool) {
    throw new Error('fastify-oracledb: must supply options.pool oracledb pool options')
  }

  if (options.outFormat) {
    oracledb.outFormat = oracledb[options.outFormat.toUpperCase()]
  }

  if (options.fetchAsString) {
    oracledb.fetchAsString = options.fetchAsString.map(t => oracledb[t.toUpperCase()])
  }

  let pool
  try {
    pool = await oracledb.createPool(options.pool)
  } catch (err) {
    throw new Error('fastify-oracledb: failed to create pool-' + err.message)
  }
  decorateFastifyInstance(pool, fastify, options)
}

module.exports = fp(fastifyOracleDB, {
  fastify: '5.x',
  name: 'fastify-oracledb'
})
