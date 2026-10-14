/**
 * RuleTester coverage for `no-clipped-user-text`.
 *
 * Runs under node:test with the companion tests: `pnpm --filter
 * @shelf/companion test`. Each case is its own node:test test.
 *
 * @see {@link file://./no-clipped-user-text.cjs}
 */

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const rule = require("./no-clipped-user-text.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const clipped = (field) => [{ messageId: "clippedUserText", data: { field } }];

ruleTester.run("no-clipped-user-text", rule, {
  valid: [
    // The shared component that clips and offers Show more.
    `<ExpandableText text={booking.description} numberOfLines={3} />`,
    // No numberOfLines: the whole text renders.
    `<Text style={styles.description}>{booking.description}</Text>`,
    // Names and titles are labels, not free text.
    `<Text numberOfLines={1}>{booking.name}</Text>`,
    `<Text numberOfLines={2}>{audit.title}</Text>`,
    // Not the field itself, only something derived from its owner.
    `<Text numberOfLines={1}>{formatDate(note.createdAt)}</Text>`,
    // A clipped preview inside a pressable opens the full item on tap.
    `<TouchableOpacity onPress={open}><Image /><Text numberOfLines={2}>{image.description}</Text></TouchableOpacity>`,
    `<Pressable onPress={open}><View><Text numberOfLines={1}>{item.description}</Text></View></Pressable>`,
    `<TouchableHighlight onPress={open}><Text numberOfLines={1}>{note.content}</Text></TouchableHighlight>`,
    `<TouchableWithoutFeedback onPress={open}><Text numberOfLines={1}>{comment}</Text></TouchableWithoutFeedback>`,
    // An onPress that opens something, with only layout between.
    `<Pressable onPress={() => router.push(href)}><View><Text numberOfLines={2}>{note.content}</Text></View></Pressable>`,
    // numberOfLines that can be unlimited is a hand-rolled expandable text.
    `<Text numberOfLines={expanded ? undefined : 3}>{booking.description}</Text>`,
    `<Text numberOfLines={expanded ? 0 : 3}>{booking.description}</Text>`,
    `<Text numberOfLines={0}>{booking.description}</Text>`,
    // Only map/flatMap callbacks render what they return.
    `<Text numberOfLines={1}>{items.filter((item) => item.note).length}</Text>`,
    `<Text numberOfLines={1}>{items.map((item) => item.name).join(", ")}</Text>`,
    // A call on something that is not the field.
    `<Text numberOfLines={1}>{formatCount(notes.length)}</Text>`,
    // TextInput's numberOfLines is the input height.
    `<TextInput multiline numberOfLines={4} value={description} onChangeText={setDescription} />`,
  ],
  invalid: [
    {
      code: `<View>{booking.description ? (<Text style={styles.description} numberOfLines={3}>{booking.description}</Text>) : null}</View>`,
      errors: clipped("description"),
    },
    {
      code: `<View>{audit.description ? (<Text style={styles.description} numberOfLines={3}>{audit.description}</Text>) : null}</View>`,
      errors: clipped("description"),
    },
    {
      code: `<Text numberOfLines={2}>{booking?.description ?? "No description"}</Text>`,
      errors: clipped("description"),
    },
    {
      code: `<Text numberOfLines={2}>{note}</Text>`,
      errors: clipped("note"),
    },
    {
      code: `<Text numberOfLines={2}>{entry.Notes}</Text>`,
      errors: clipped("Notes"),
    },
    {
      code: `<Text numberOfLines={2}>{\`Comment: \${item.comment}\`}</Text>`,
      errors: clipped("comment"),
    },
    {
      code: `<Text numberOfLines={1}>{expanded ? log.message : log.content}</Text>`,
      errors: clipped("message"),
    },
    // Other Text components clip the same way.
    {
      code: `<Animated.Text numberOfLines={2}>{note.content}</Animated.Text>`,
      errors: clipped("content"),
    },
    // Calls render the field they wrap.
    {
      code: `<Text numberOfLines={3}>{stripMarkdown(booking.description)}</Text>`,
      errors: clipped("description"),
    },
    {
      code: `<Text numberOfLines={3}>{booking.description.trim()}</Text>`,
      errors: clipped("description"),
    },
    // A map callback renders the field it returns.
    {
      code: `<Text numberOfLines={3}>{items.map((item) => item.description).join(", ")}</Text>`,
      errors: clipped("description"),
    },
    {
      code: `<Text numberOfLines={3}>{entries.flatMap(function (entry) { return [entry.content]; })}</Text>`,
      errors: clipped("content"),
    },
    // Nested Text lays out inside the clipped parent.
    {
      code: `<Text numberOfLines={3}><Text style={styles.label}>Notes: </Text><Text>{note}</Text></Text>`,
      errors: clipped("note"),
    },
    // A screen wrapper that dismisses the keyboard is not a card.
    {
      code: `<TouchableWithoutFeedback onPress={Keyboard.dismiss}><View><Text numberOfLines={3}>{booking.description}</Text></View></TouchableWithoutFeedback>`,
      errors: clipped("description"),
    },
    {
      code: `<Pressable onPress={() => Keyboard.dismiss()}><Text numberOfLines={3}>{booking.description}</Text></Pressable>`,
      errors: clipped("description"),
    },
    // A pressable around a scroll view wraps a screen, not a card.
    {
      code: `<Pressable onPress={close}><ScrollView><Text numberOfLines={3}>{booking.description}</Text></ScrollView></Pressable>`,
      errors: clipped("description"),
    },
    // A pressable with no onPress opens nothing.
    {
      code: `<Pressable><Text numberOfLines={3}>{booking.description}</Text></Pressable>`,
      errors: clipped("description"),
    },
    // A fixed limit on either branch still clips.
    {
      code: `<Text numberOfLines={compact ? 1 : 3}>{booking.description}</Text>`,
      errors: clipped("description"),
    },
    // A pressable sibling is not an ancestor.
    {
      code: `<View><Pressable onPress={open} /><Text numberOfLines={3}>{booking.description}</Text></View>`,
      errors: clipped("description"),
    },
  ],
});
