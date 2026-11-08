# Reproducing the executable analysis

Every VERIFIED claim in `docs/engine/` about the original executable can be re-derived with
these Ghidra scripts and your own copy of the game. Nothing from the executable is stored in
this repository; the scripts only read what you point them at.

1. Install [Ghidra](https://github.com/NationalSecurityAgency/ghidra/releases) (12.x) and a
   JDK it accepts (12.2 needs JDK 25). On Apple Silicon the release zip ships no native
   decompiler: run `gradle buildNatives` inside `support/gradle/` once.
2. Import and analyse your executable headlessly:
   ```sh
   analyzeHeadless ~/ghidra-proj original -import /path/to/your/copy/civ2.exe -loader PeLoader
   ```
3. Run a script against the analysed program, for example to decompile the attack handler:
   ```sh
   analyzeHeadless ~/ghidra-proj original -process civ2.exe -noanalysis \
     -scriptPath tools/ghidra -postScript DecompileOne.java 0x0052d472 attack.c
   ```

| script                | arguments         | prints                                                                                                                      |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| DumpFunctions.java    | out.tsv           | every function: address, size, name, callers, callees                                                                       |
| DecompileOne.java     | address out.c     | the decompiled C of one function                                                                                            |
| FindStringRefs.java   | substring…        | defined strings containing a substring and who references them                                                              |
| RefsToAddrs.java      | address…          | functions referencing each data address; those using ≥ 3                                                                    |
| FindScalar.java       | value…            | instructions carrying a given immediate (e.g. RNG constants)                                                                |
| CallersOf.java        | function-address… | callers of a function, including through thunks                                                                             |
| ApplyFunctionMap.java | function-map.tsv  | names and comments every function from `docs/functions/function-map.tsv` and labels the main tables (see `docs/roadmap.md`) |

Addresses in `docs/engine/exe-notes.md` are for the Multiplayer Gold Edition executable with
SHA-256 `f5196e31…b04c40` (see `docs/research/inventory.sha256`). Other editions differ.

Reminder from CONTRIBUTING.md: read the decompiled C to understand behaviour, write that
behaviour down in `docs/engine/`, and implement from the document. Never paste decompiled code.
