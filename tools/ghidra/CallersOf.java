// Print the functions that call each given function address (direct calls and thunks).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.util.*;
public class CallersOf extends GhidraScript {
    @Override public void run() throws Exception {
        for (String a : getScriptArgs()) {
            Function f = getFunctionAt(toAddr(a));
            if (f == null) { println("CALLERS " + a + ": no function"); continue; }
            TreeSet<String> names = new TreeSet<>();
            for (Function c : f.getCallingFunctions(monitor)) names.add(c.getName() + "@" + c.getEntryPoint());
            // also thunks to f
            for (Function t : currentProgram.getFunctionManager().getFunctions(true))
                if (t.isThunk() && f.equals(t.getThunkedFunction(true)))
                    for (Function c : t.getCallingFunctions(monitor)) names.add(c.getName() + "@" + c.getEntryPoint() + "(via thunk " + t.getEntryPoint() + ")");
            println("CALLERS " + f.getName() + " " + names.size() + ": " + String.join(" ", names));
        }
    }
}
