## webrtc-signalling-middleware ##

This package provides mountable middleware for single server express apps, which provides everything you need server side to do signalling for p2p webrtc experiments. The goal is to make it easier to play with webrtc on glitch.com. Take a look at the webrtc-signal-client package for a simple client to this service.

### Usage: ###

```js
const express = require('express')
const app = express()
const signalling = require('webrtc-signalling-middleware')

const peers = signalling()
app.use('/webrtc', peers)

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`)
})
```

### Constructor options ###

 - presence: boolean, (default true) should the signalling service tell clients which other nodes are connected?
 - idLength: integer, (default 16) how many characters should the client ID numbers contain? each character adds around 6 bits of randomness to the ID. Should be long enough to statistically avoid collisions. At 16 digits it's a 96 bit number.
 - timeout: integer, (default 10000 = 10s) milliseconds service should wait before deciding a client has expired and disconnected

### API ###

The middleware exposes several potentially useful features:

#### peers.getPeerList()

Returns an array of peer ID strings currently considered to be connected to the service. This also expires any peers that have timed out. If you need to clean up the list manually, you might call this at an interval.

#### peers.sendRaw(peerID, object)

Sends a message to the client over event-stream. This probably shouldn't be used unless you're building a custom client

#### peers.sendData(peerID, object)

Sends a data message to the client over event-stream. This is recommended for sending extra messages to your clients. With the `webrtc-signal-client` package this causes the `client.onData` callback to be called, and passed the JSON deserialized object.

#### peers.broadcastRaw(object)

Sends a message to all connected clients over event-stream. Probably don't use this, use the next one

#### peers.broadcastData(object)

Sends a data message to all connected clients over event-stream. As with `peers.sendData` this will execute an `onData` callback if used with the `webrtc-signal-client` package.


### Web API ###

Connecting to this middleware with a custom client is pretty simple. Here's the basic flow:

 - GET `/path/to/middleware/connect` - returns json `{"id":"some random ID","key":"some secret key"}`
 - connect EventSource to `/path/to/middleware/events?id=[id from connect response]&key=[key from connect response]` 

the EventSource will emit `message` events containing JSON, which may contain the following properties:

 - `presence`: an array of peerIDs that are currently connected to the service
 - `connect`: an array of new peerIDs that have connected
 - `disconnect`: an array of peerIDs that were connected but have just disconnected or expired
 - `data`: an object supplied to `peer.sendData` or `peer.broadcastData` server side
 - `signal`: an object sent in by another client using the `/send-signal/:to` endpoint described below

To send webrtc signalling information, HTTP POST to `/path/to/middleware/send-signal/[destination peerID]`

The post body must contain a JSON object:

```json
{
  "id": "id number supplied by /connect endpoint",
  "key": "key supplied by /connect endpoint",
  "signal": <json serializable object>
}
```

the signal will be passed to the destination peer. If they're temporarily disconnected from the service it will be queued and delivered once they reconnect to `/events` or dropped if their connection is expired by timeout. Delivery is not guarenteed.

If your client application is in javascript, make sure to check out the `webrtc-signal-client` package for an easy way to hook this up.
