// Prints a Web Push key pair for this app's environment (PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY, Mytko Kit
// docs/push.md). Once: new keys make every device switch notifications on again.
require("../kit").vapidKeysCli();
