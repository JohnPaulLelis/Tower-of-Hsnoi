% Tower of Hanoi - SWI-Prolog server
% run: swipl hanoi.pl   then open http://localhost:8080/
%
% note: library(http/json) is NOT used on purpose. It loads json.dll, which
% Windows Application Control can block. The little JSON we need is read and
% written by hand below, so this only uses pure prolog.

:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_files)).
:- use_module(library(dcg/basics)).
:- use_module(library(lists)).
:- use_module(library(apply)).

% so the server can find index.html, css and js even if swipl
% was started from another folder
:- multifile user:file_search_path/2.
:- dynamic   user:file_search_path/2.
:- prolog_load_context(directory, Dir),
   asserta(user:file_search_path(hanoi_app, Dir)).

% routes (one per file so css/js don't get mixed up)
:- http_handler(root(.),               serve_index,  []).
:- http_handler(root('css/style.css'), serve_css,    []).
:- http_handler(root('js/game.js'),    serve_js,     []).
:- http_handler(root('api/move'),      handle_move,  [method(post)]).
:- http_handler(root('api/solve'),     handle_solve, [method(post)]).

serve_index(Request) :-
    serve_file('index.html', text/html, Request).

serve_css(Request) :-
    serve_file('css/style.css', text/css, Request).

serve_js(Request) :-
    serve_file('js/game.js', text/javascript, Request).

% http_reply_file doesn't accept a plain absolute path,
% so we use the hanoi_app alias from above
serve_file(Relative, MimeType, Request) :-
    http_reply_file(hanoi_app(Relative), [mime_type(MimeType)], Request).

% POST /api/move  {state, from, to}
handle_move(Request) :-
    read_json_body(Request, Obj),
    (   catch(( memberchk(state-State, Obj),
                memberchk(from-From, Obj),
                memberchk(to-To, Obj),
                valid_move(State, From, To, NewState)
              ), _, fail)
    ->  format('Content-type: application/json~n~n'),
        format('{"valid": true, "newState": ~w}', [NewState])
    ;   format('Content-type: application/json~n~n'),
        format('{"valid": false}')
    ).

% POST /api/solve  {disks, pegs}
handle_solve(Request) :-
    read_json_body(Request, Obj),
    (   memberchk(disks-N, Obj) -> true ; N = 0 ),
    (   memberchk(pegs-P, Obj)  -> true ; P = 3 ),
    (   integer(N), N >= 1, N =< 16, P == 3
    ->  hanoi(N, 0, 2, 1, Moves),
        maplist(move_json, Moves, Parts),
        atomic_list_concat(Parts, ',', Joined),
        format('Content-type: application/json~n~n'),
        format('{"moves": [~w]}', [Joined])
    ;   throw(http_reply(bad_request('disks must be 1 to 16 and pegs must be 3')))
    ).

move_json(move(F, T), Json) :-
    format(atom(Json), '{"from":~w,"to":~w}', [F, T]).

% ---- tiny JSON reader ----
% reads the request body and turns a json object into a list like
% [state-[[3,2,1],[],[]], from-0, to-2]
% if the body is missing or broken we just give back []

read_json_body(Request, Pairs) :-
    memberchk(input(In), Request),
    memberchk(content_length(Len), Request),
    read_string(In, Len, Body),
    string_codes(Body, Codes),
    once(phrase(object(Pairs), Codes)),
    !.
read_json_body(_, []).

object(Pairs) -->
    blanks, "{", blanks,
    (   "}"
    ->  { Pairs = [] }
    ;   pairs(Pairs), blanks, "}"
    ),
    blanks.

pairs([Key-Value|T]) -->
    string_lit(KeyString), blanks, ":", blanks,
    value(Value), blanks,
    (   ","
    ->  blanks, pairs(T)
    ;   { T = [] }
    ),
    { atom_string(Key, KeyString) }.

array(List) -->
    "[", blanks,
    (   "]"
    ->  { List = [] }
    ;   elements(List), blanks, "]"
    ).

elements([V|T]) -->
    value(V), blanks,
    (   ","
    ->  blanks, elements(T)
    ;   { T = [] }
    ).

value(V) -->
    (   object(V)     -> []
    ;   array(V)      -> []
    ;   string_lit(V) -> []
    ;   "true"        -> { V = true }
    ;   "false"       -> { V = false }
    ;   "null"        -> { V = null }
    ;   number(V)
    ).

string_lit(S) -->
    "\"", str_chars(Cs),
    { string_codes(S, Cs) }.

% 34 is the " character and 92 is the backslash
str_chars(Cs) -->
    [C],
    (   { C == 34 }
    ->  { Cs = [] }
    ;   { C == 92 }
    ->  [E], { esc(E, X), Cs = [X|T] }, str_chars(T)
    ;   { Cs = [C|T] }, str_chars(T)
    ).

esc(0'n, 10) :- !.
esc(0't, 9)  :- !.
esc(E, E).

% ---- game logic ----
% state is a list of 3 pegs, each peg is a list from bottom to top
% example: [[3,2,1],[],[]]   (pegs are numbered 0, 1, 2)

% valid_move(+State, +From, +To, -NewState)
valid_move(State, From, To, NewState) :-
    is_list(State),
    length(State, NumPegs),
    integer(From), integer(To),
    From >= 0, From < NumPegs,
    To   >= 0, To   < NumPegs,
    From =\= To,
    nth0(From, State, SourcePeg),
    nth0(To,   State, TargetPeg),
    last(SourcePeg, TopDisk),
    integer(TopDisk),
    (   TargetPeg == []
    ->  true
    ;   last(TargetPeg, TargetTop),
        TopDisk < TargetTop
    ),
    once(append(SourceRest, [TopDisk], SourcePeg)),
    append(TargetPeg, [TopDisk], NewTarget),
    set_peg(From, SourceRest, State,  State1),
    set_peg(To,   NewTarget,  State1, NewState).

% replace the peg at Index with a new list
set_peg(Index, Peg, State0, State) :-
    nth0(Index, State0, _, Rest),
    nth0(Index, State,  Peg, Rest).

% hanoi(+N, +From, +To, +Via, -Moves)
hanoi(0, _, _, _, []) :- !.
hanoi(N, From, To, Via, Moves) :-
    N1 is N - 1,
    hanoi(N1, From, Via, To, Moves1),
    hanoi(N1, Via, To, From, Moves2),
    append(Moves1, [move(From, To)], Moves12),
    append(Moves12, Moves2, Moves).

% start the server, then wait forever so swipl doesn't exit
:- initialization(main).

main :-
    Port = 8080,
    http_server(http_dispatch, [port(Port)]),
    format("~nServer running at http://localhost:~w/~n", [Port]),
    format("Press Ctrl+C twice to stop.~n"),
    thread_get_message(_).
