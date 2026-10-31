// For each defined string containing any of the given substrings, print its address and the
// functions that reference it. Args: substrings...
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
public class FindStringRefs extends GhidraScript {
    @Override public void run() throws Exception {
        String[] needles = getScriptArgs();
        DataIterator it = currentProgram.getListing().getDefinedData(true);
        while (it.hasNext()) {
            Data d = it.next();
            if (!d.hasStringValue()) continue;
            Object v = d.getValue();
            if (!(v instanceof String)) continue;
            String s = (String) v;
            for (String n : needles) {
                if (s.contains(n)) {
                    StringBuilder sb = new StringBuilder();
                    for (Reference r : getReferencesTo(d.getAddress())) {
                        Function f = getFunctionContaining(r.getFromAddress());
                        sb.append(f == null ? "?" : f.getName() + "@" + f.getEntryPoint()).append(" ");
                    }
                    println("STR " + d.getAddress() + " \"" + s.replace("\n","\\n") + "\" <- " + sb);
                    break;
                }
            }
        }
    }
}
