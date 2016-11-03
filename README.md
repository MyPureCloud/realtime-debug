This is an extension which helps debug PureCloud's realtime APIs. Intended for use in
development of PureCloud or PureCloud integrations.

Contributing, developing:
  - `npm install`
  - `npm test` - runs linter and builds extension

Install:
 - https://chrome.google.com/webstore/detail/cgcbglankfpindfcechphhmcnoljajkl

Install for localhost:
 - Clone repo and ensure localhost is listed in manifest, then install from
 chrome://extensions

Use:
 - `debugRealtime(/jabber:client/, 'log', { absoluteTime: true, filterRealtime: /transport-info/ });`
