Read-only Mini App preflight — complete, nothing needs building here.

Results (HaulTracker Pro Telegram - Production connection, getMe + getChatMenuButton only):
- Bot id: 8810994124
- Username: @HaulTrackerBot
- has_main_web_app: false
- Default menu button: type "commands" (no web_app, no public URL)

Write capability (not called): the connected tool passes generic Bot API requests through, so setChatMenuButton (menu_button type web_app) and sendMessage/editMessageReplyMarkup with inline web_app buttons are supported endpoints. Each write needs separate approval. Main Mini App (has_main_web_app) is configured in BotFather, not through the API.

No code, SQL, deploy, secret, menu or message changes made.
