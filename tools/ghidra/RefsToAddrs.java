// Print the functions that reference each given address (data refs, incl. base+index LEA/MOV).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.util.*;
public class RefsToAddrs extends GhidraScript {
    @Override public void run() throws Exception {
        Map<String,Set<String>> byFunc = new TreeMap<>();
        for (String a : getScriptArgs()) {
            TreeSet<String> fs = new TreeSet<>();
            for (Reference r : getReferencesTo(toAddr(a))) {
                Function f = getFunctionContaining(r.getFromAddress());
                String n = f == null ? "?" : f.getName();
                fs.add(n);
                byFunc.computeIfAbsent(n, k -> new TreeSet<>()).add(a);
            }
            println("REF " + a + " <- " + fs.size() + ": " + String.join(" ", fs));
        }
        for (Map.Entry<String,Set<String>> e : byFunc.entrySet())
            if (e.getValue().size() >= 3) println("MULTI " + e.getKey() + " uses " + e.getValue());
    }
}
