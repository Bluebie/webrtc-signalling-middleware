// simple middleware to facilitate signalling for WebRTC p2p connections

const express = require('express')
const sse = require('connect-sse')()
const crypto = require('crypto')
const process = require('process')

module.exports = function ({ idLength = 16, timeout = 10000, presence = true } = {}) {
  const app = express.Router()

  app.use(express.json())

  // make a crypto random ID, encoded in a compact format
  function makeID (length = 16) {
    const chars = []
    while (chars.length < length) {
      const options = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$'
      const digit = options[Math.floor(crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF * options.length)]
      chars.push(digit)
    }
    return chars.join('')
  }

  function validateID (id, length = 16) {
    return !!id.match(/^[a-zA-Z0-9]+$/) && id.length === length
  }

  // make a key that matches the ID provided
  function makeKey (id) {
    const hmac = crypto.createHmac('sha256', process.env.SECRET || crypto.randomBytes(256))
    hmac.update(id)
    return hmac.digest('base64')
  }

  // collection of all currently subscribed users
  const connectedUsers = {}
  const streams = new WeakMap()

  // send a raw message over the event-stream channel
  app.sendRaw = function (to, message) {
    const stream = streams.get(connectedUsers[to])
    if (stream) {
      stream.json(message)
    } else {
      connectedUsers[to].queue.push(message)
    }
  }

  // send data to the client over the event-stream channel
  app.sendData = function (to, data) {
    return app.sendRaw(to, { data })
  }

  // broadcast data to everyone connected
  app.broadcastRaw = function (message) {
    app.getPeerList().forEach(peerID => app.sendRaw(peerID, message))
  }

  // broadcast data to everyone connected
  app.broadcastData = function (data) {
    app.broadcastRaw({ data })
  }

  // get a list of connected peers
  app.getPeerList = function () {
    // clean up any expired users
    const now = Date.now()
    const keys = Object.keys(connectedUsers)
    const removed = []
    for (const key of keys) {
      if (connectedUsers[key].timeout < now && !streams.has(key)) {
        removed.push(key)
        delete connectedUsers[key]
      }
    }

    // update still connected users if the presence list changed
    const connected = Object.keys(connectedUsers)
    if (presence && removed.length > 0) {
      connected.forEach(peerID => app.sendRaw(peerID, { disconnect: removed }))
    }

    return connected
  }

  app.get('/connect', (req, res) => {
    const id = makeID(idLength)
    const peer = {
      id,
      key: makeKey(id),
      queue: [],
      timeout: Date.now() + timeout
    }
    connectedUsers[peer.id] = peer

    if (presence) {
      const connected = app.getPeerList()
      connected.forEach(peerID => {
        if (peerID !== id) app.sendRaw(peerID, { connect: [id] })
      })
    }

    res.json({ id: peer.id, key: peer.key })
  })

  app.get('/disconnect', (req, res) => {
    const peer = connectedUsers[req.query.id]
    if (!peer) return res.sendStatus(500)
    if (peer.key !== req.query.key) return res.sendStatus(401)
    streams.delete(peer)
    peer.timeout = 0 // expire it
    app.getPeerList() // trigger expiration
  })

  app.get('/events', sse, (req, res) => {
    let peer = connectedUsers[req.query.id]
    if (!peer && validateID(req.query.id, idLength) && makeKey(req.query.id) === req.query.key) {
      // server may have rebooted? recreate user
      peer = {
        id: req.query.id,
        key: makeKey(req.query.id),
        queue: [],
        timeout: Infinity
      }
      connectedUsers[req.query.id] = peer

      // notify users if presence is enabled
      if (presence) {
        const connected = app.getPeerList()
        connected.forEach(peerID => {
          if (peerID !== peer.id) app.sendRaw(peerID, { connect: [peer.id] })
        })
      }
    }

    if (req.query.key !== peer.key) return res.json({ error: 'incorrect key' })

    while (peer.queue && peer.queue.length > 0) {
      res.json(peer.queue.shift())
    }

    if (presence) {
      res.json({ presence: app.getPeerList() })
    }

    streams.set(peer, res)

    res.on('close', () => {
      peer.timeout = Date.now() + timeout
      streams.delete(peer)
      setTimeout(app.getPeerList, timeout * 1.1)
    })
  })

  app.post('/send-signal/:to', (req, res) => {
    const peer = connectedUsers[req.body.id]
    if (!peer) return res.sendStatus(500)
    if (req.body.key !== peer.key) return res.sendStatus(401)

    const to = connectedUsers[req.params.to]
    if (!to) return res.sendStatus(404)

    app.sendRaw(to.id, { from: peer.id, signal: req.body.signal })

    res.json({ success: true })
  })

  return app
}
