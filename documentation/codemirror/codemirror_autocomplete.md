
@codemirror/autocomplete

interface Completion

    Objects type used to represent individual completions.

    label: string

        The label to show in the completion picker. This is what input is matched against to determine whether a completion matches (and how well it matches).
    displayLabel⁠?: string

        An optional override for the completion's visible label. When using this, matched characters will only be highlighted if you provide a getMatch function.
    detail⁠?: string

        An optional short piece of information to show (with a different style) after the label.
    info⁠?: string |
    fn(completion: Completion) → Node |
    {dom: Node, destroy⁠?: fn()} |
    Promise<CompletionInfo> |
    null

        Additional info to show when the completion is selected. Can be a plain string or a function that'll render the DOM structure to show when invoked.
    apply⁠?: string |
    fn(
    view: EditorView,
    completion: Completion,
    from: number,
    to: number
    )

        How to apply the completion. The default is to replace it with its label. When this holds a string, the completion range is replaced by that string. When it is a function, that function is called to perform the completion. If it fires a transaction, it is responsible for adding the pickedCompletion annotation to it.
    type⁠?: string

        The type of the completion. This is used to pick an icon to show for the completion. Icons are styled with a CSS class created by appending the type name to "cm-completionIcon-". You can define or restyle icons by defining these selectors. The base library defines simple icons for class, constant, enum, function, interface, keyword, method, namespace, property, text, type, and variable.

        Multiple types can be provided by separating them with spaces.
    commitCharacters⁠?: readonly string[]

        When this option is selected, and one of these characters is typed, insert the completion before typing the character.
    boost⁠?: number

        When given, should be a number from -99 to 99 that adjusts how this completion is ranked compared to other completions that match the input as well as this one. A negative number moves it down the list, a positive number moves it up.
    section⁠?: string | CompletionSection

        Can be used to divide the completion list into sections. Completions in a given section (matched by name) will be grouped together, with a heading above them. Options without section will appear above all sections. A string value is equivalent to a {name} object.

type CompletionInfo = Node | {dom: Node, destroy⁠?: fn()} | null

    The type returned from Completion.info. May be a DOM node, null to indicate there is no info, or an object with an optional destroy method that cleans up the node.
interface CompletionSection

    Object used to describe a completion section. It is recommended to create a shared object used by all the completions in a given section.

    name: string

        The name of the section. If no render method is present, this will be displayed above the options.
    header⁠?: fn(section: CompletionSection) → HTMLElement

        An optional function that renders the section header. Since the headers are shown inside a list, you should make sure the resulting element has a display: list-item style.
    rank⁠?: number | "dynamic"

        By default, sections are ordered alphabetically by name. To specify an explicit order, rank can be used. Sections with a lower rank will be shown above sections with a higher rank.

        When set to "dynamic", the section's position compared to other dynamic sections depends on the matching score of the best-matching option in the sections.

autocompletion(config⁠?: Object = {}) → Extension

    Returns an extension that enables autocompletion.

    config

        activateOnTyping⁠?: boolean

            When enabled (defaults to true), autocompletion will start whenever the user types something that can be completed.
        activateOnCompletion⁠?: fn(completion: Completion) → boolean

            When given, if a completion that matches the predicate is picked, reactivate completion again as if it was typed normally.
        activateOnTypingDelay⁠?: number

            The amount of time to wait for further typing before querying completion sources via activateOnTyping. Defaults to 100, which should be fine unless your completion source is very slow and/or doesn't use validFor.
        selectOnOpen⁠?: boolean

            By default, when completion opens, the first option is selected and can be confirmed with acceptCompletion. When this is set to false, the completion widget starts with no completion selected, and the user has to explicitly move to a completion before you can confirm one.
        override⁠?: readonly CompletionSource[]

            Override the completion sources used. By default, they will be taken from the "autocomplete" language data (which should hold completion sources or arrays of completions).
        closeOnBlur⁠?: boolean

            Determines whether the completion tooltip is closed when the editor loses focus. Defaults to true.
        maxRenderedOptions⁠?: number

            The maximum number of options to render to the DOM.
        defaultKeymap⁠?: boolean

            Set this to false to disable the default completion keymap. (This requires you to add bindings to control completion yourself. The bindings should probably have a higher precedence than other bindings for the same keys.)
        aboveCursor⁠?: boolean

            By default, completions are shown below the cursor when there is space. Setting this to true will make the extension put the completions above the cursor when possible.
        tooltipClass⁠?: fn(state: EditorState) → string

            When given, this may return an additional CSS class to add to the completion dialog element.
        optionClass⁠?: fn(completion: Completion) → string

            This can be used to add additional CSS classes to completion options.
        icons⁠?: boolean

            By default, the library will render icons based on the completion's type in front of each option. Set this to false to turn that off.
        addToOptions⁠?: {
        render: fn(
        completion: Completion,
        state: EditorState,
        view: EditorView
        ) → Node | null,
        position: number
        }[]

            This option can be used to inject additional content into options. The render function will be called for each visible completion, and should produce a DOM node to show. position determines where in the DOM the result appears, relative to other added widgets and the standard content. The default icons have position 20, the label position 50, and the detail position 80.
        positionInfo⁠?: fn(
        view: EditorView,
        list: Rect,
        option: Rect,
        info: Rect,
        space: Rect
        ) → {style⁠?: string, class⁠?: string}

            By default, info tooltips are placed to the side of the selected completion. This option can be used to override that. It will be given rectangles for the list of completions, the selected option, the info element, and the availble tooltip space, and should return style and/or class strings for the info element.
        compareCompletions⁠?: fn(a: Completion, b: Completion) → number

            The comparison function to use when sorting completions with the same match score. Defaults to using localeCompare.
        filterStrict⁠?: boolean

            When set to true (the default is false), turn off fuzzy matching of completions and only show those that start with the text the user typed. Only takes effect for results where filter isn't false.
        interactionDelay⁠?: number

            By default, commands relating to an open completion only take effect 75 milliseconds after the completion opened, so that key presses made before the user is aware of the tooltip don't go to the tooltip. This option can be used to configure that delay.
        updateSyncTime⁠?: number

            When there are multiple asynchronous completion sources, this controls how long the extension waits for a slow source before displaying results from faster sources. Defaults to 100 milliseconds.

completionStatus(state: EditorState) → "active" | "pending" | null

    Get the current completion status. When completions are available, this will return "active". When completions are pending (in the process of being queried), this returns "pending". Otherwise, it returns null.
currentCompletions(state: EditorState) → readonly Completion[]

    Returns the available completions as an array.
selectedCompletion(state: EditorState) → Completion | null

    Return the currently selected completion, if any.
selectedCompletionIndex(state: EditorState) → number | null

    Returns the currently selected position in the active completion list, or null if no completions are active.
setSelectedCompletion(index: number) → StateEffect<unknown>

    Create an effect that can be attached to a transaction to change the currently selected completion.
pickedCompletion: AnnotationType<Completion>

    This annotation is added to transactions that are produced by picking a completion.

Sources

class CompletionContext

    An instance of this is passed to completion source functions.

    new CompletionContext(
    state: EditorState,
    pos: number,
    explicit: boolean,
    view⁠?: EditorView
    )

        Create a new completion context. (Mostly useful for testing completion sources—in the editor, the extension will create these for you.)
    state: EditorState

        The editor state that the completion happens in.
    pos: number

        The position at which the completion is happening.
    explicit: boolean

        Indicates whether completion was activated explicitly, or implicitly by typing. The usual way to respond to this is to only return completions when either there is part of a completable entity before the cursor, or explicit is true.
    view⁠?: EditorView

        The editor view. May be undefined if the context was created in a situation where there is no such view available, such as in synchronous updates via CompletionResult.update or when called by test code.
    tokenBefore(types: readonly string[]) → {from: number, to: number, text: string, type: NodeType} |
    null

        Get the extent, content, and (if there is a token) type of the token before this.pos.
    matchBefore(expr: RegExp) → {from: number, to: number, text: string} | null

        Get the match of the given expression directly before the cursor.
    aborted: boolean

        Yields true when the query has been aborted. Can be useful in asynchronous queries to avoid doing work that will be ignored.
    addEventListener(
    type: "abort",
    listener: fn(),
    options⁠?: {onDocChange: boolean}
    )

        Allows you to register abort handlers, which will be called when the query is aborted.

        By default, running queries will not be aborted for regular typing or backspacing, on the assumption that they are likely to return a result with a validFor field that allows the result to be used after all. Passing onDocChange: true will cause this query to be aborted for any document change.

interface CompletionResult

    Interface for objects returned by completion sources.

    from: number

        The start of the range that is being completed.
    to⁠?: number

        The end of the range that is being completed. Defaults to the main cursor position.
    options: readonly Completion[]

        The completions returned. These don't have to be compared with the input by the source—the autocompletion system will do its own matching (against the text between from and to) and sorting.
    validFor⁠?: RegExp |
    fn(
    text: string,
    from: number,
    to: number,
    state: EditorState
    ) → boolean

        When given, further typing or deletion that causes the part of the document between (mapped) from and to to match this regular expression or predicate function will not query the completion source again, but continue with this list of options. This can help a lot with responsiveness, since it allows the completion list to be updated synchronously.
    filter⁠?: boolean

        By default, the library filters and scores completions. Set filter to false to disable this, and cause your completions to all be included, in the order they were given. When there are other sources, unfiltered completions appear at the top of the list of completions. validFor must not be given when filter is false, because it only works when filtering.
    getMatch⁠?: fn(completion: Completion, matched⁠?: readonly number[]) → readonly number[]

        When filter is set to false or a completion has a displayLabel, this may be provided to compute the ranges on the label that match the input. Should return an array of numbers where each pair of adjacent numbers provide the start and end of a range. The second argument, the match found by the library, is only passed when filter isn't false.
    update⁠?: fn(
    current: CompletionResult,
    from: number,
    to: number,
    context: CompletionContext
    ) → CompletionResult | null

        Synchronously update the completion result after typing or deletion. If given, this should not do any expensive work, since it will be called during editor state updates. The function should make sure (similar to validFor) that the completion still applies in the new state.
    map⁠?: fn(current: CompletionResult, changes: ChangeDesc) → CompletionResult | null

        When results contain position-dependent information in, for example, apply methods, you can provide this method to update the result for transactions that happen after the query. It is not necessary to update from and to—those are tracked automatically.
    commitCharacters⁠?: readonly string[]

        Set a default set of commit characters for all options in this result.

type CompletionSource = fn(context: CompletionContext) → CompletionResult |
Promise<CompletionResult | null> |
null

    The function signature for a completion source. Such a function may return its result synchronously or as a promise. Returning null indicates no completions are available.
completeFromList(list: readonly (string | Completion)[]) → CompletionSource

    Given a a fixed array of options, return an autocompleter that completes them.
ifIn(nodes: readonly string[], source: CompletionSource) → CompletionSource

    Wrap the given completion source so that it will only fire when the cursor is in a syntax node with one of the given names.
ifNotIn(nodes: readonly string[], source: CompletionSource) → CompletionSource

    Wrap the given completion source so that it will not fire when the cursor is in a syntax node with one of the given names.
completeAnyWord: CompletionSource

    A completion source that will scan the document for words (using a character categorizer), and return those as completions.
insertCompletionText(
state: EditorState,
text: string,
from: number,
to: number
) → TransactionSpec

    Helper function that returns a transaction spec which inserts a completion's text in the main selection range, and any other selection range that has the same text in front of it.

Commands

startCompletion: Command

    Explicitly start autocompletion.
closeCompletion: Command

    Close the currently active completion.
acceptCompletion: Command

    Accept the current completion.
moveCompletionSelection(forward: boolean, by⁠?: "option" | "page" = "option") → Command

    Returns a command that moves the completion selection forward or backward by the given amount.
completionKeymap: readonly KeyBinding[]

    Basic keybindings for autocompletion.

        Ctrl-Space (and Alt-` or Alt-i on macOS): startCompletion
        Escape: closeCompletion
        ArrowDown: moveCompletionSelection(true)
        ArrowUp: moveCompletionSelection(false)
        PageDown: moveCompletionSelection(true, "page")
        PageUp: moveCompletionSelection(false, "page")
        Enter: acceptCompletion

Snippets

snippet(template: string) → fn(
editor: {state: EditorState, dispatch: fn(tr: Transaction)},
completion: Completion | null,
from: number,
to: number
)

    Convert a snippet template to a function that can apply it. Snippets are written using syntax like this:

    "for (let ${index} = 0; ${index} < ${end}; ${index}++) {\n\t${}\n}"

    Each ${} placeholder (you may also use #{}) indicates a field that the user can fill in. Its name, if any, will be the default content for the field.

    When the snippet is activated by calling the returned function, the code is inserted at the given position. Newlines in the template are indented by the indentation of the start line, plus one indent unit per tab character after the newline.

    On activation, (all instances of) the first field are selected. The user can move between fields with Tab and Shift-Tab as long as the fields are active. Moving to the last field or moving the cursor out of the current field deactivates the fields.

    The order of fields defaults to textual order, but you can add numbers to placeholders (${1} or ${1:defaultText}) to provide a custom order.

    To include a literal { or } in your template, put a backslash in front of it. This will be removed and the brace will not be interpreted as indicating a placeholder.
snippetCompletion(template: string, completion: Completion) → Completion

    Create a completion from a snippet. Returns an object with the properties from completion, plus an apply function that applies the snippet.
nextSnippetField: StateCommand

    Move to the next snippet field, if available.
hasNextSnippetField(state: EditorState) → boolean

    Check if there is an active snippet with a next field for nextSnippetField to move to.
prevSnippetField: StateCommand

    Move to the previous snippet field, if available.
hasPrevSnippetField(state: EditorState) → boolean

    Returns true if there is an active snippet and a previous field for prevSnippetField to move to.
clearSnippet: StateCommand

    A command that clears the active snippet, if any.
snippetKeymap: Facet<readonly KeyBinding[], readonly KeyBinding[]>

    A facet that can be used to configure the key bindings used by snippets. The default binds Tab to nextSnippetField, Shift-Tab to prevSnippetField, and Escape to clearSnippet.

Automatic Bracket Closing

interface CloseBracketConfig

    Configures bracket closing behavior for a syntax (via language data) using the "closeBrackets" identifier.

    brackets⁠?: string[]

        The opening brackets to close. Defaults to ["(", "[", "{", "'", '"']. Brackets may be single characters or a triple of quotes (as in "'''").
    before⁠?: string

        Characters in front of which newly opened brackets are automatically closed. Closing always happens in front of whitespace. Defaults to ")]}:;>".
    stringPrefixes⁠?: string[]

        When determining whether a given node may be a string, recognize these prefixes before the opening quote.

closeBrackets() → Extension

    Extension to enable bracket-closing behavior. When a closeable bracket is typed, its closing bracket is immediately inserted after the cursor. When closing a bracket directly in front of a closing bracket inserted by the extension, the cursor moves over that bracket.
closeBracketsKeymap: readonly KeyBinding[]

    Close-brackets related key bindings. Binds Backspace to deleteBracketPair.
deleteBracketPair: StateCommand

    Command that implements deleting a pair of matching brackets when the cursor is between them.
insertBracket(state: EditorState, bracket: string) → Transaction | null

    Implements the extension's behavior on text insertion. If the given string counts as a bracket in the language around the selection, and replacing the selection with it requires custom behavior (inserting a closing version or skipping past a previously-closed bracket), this function returns a transaction representing that custom behavior. (You only need this if you want to programmatically insert brackets—the closeBrackets extension will take care of running this for user input.)

