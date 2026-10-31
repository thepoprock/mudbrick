// Dump every function: address, size, name, #callers, #callees, as TSV. Arg0 = output path.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;
public class DumpFunctions extends GhidraScript {
    @Override public void run() throws Exception {
        String out = getScriptArgs()[0];
        PrintWriter w = new PrintWriter(new FileWriter(out));
        w.println("address\tsize\tname\tcallers\tcallees\tthunk");
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        int n = 0;
        while (it.hasNext()) {
            Function f = it.next();
            long size = f.getBody().getNumAddresses();
            int callers = f.getCallingFunctions(monitor).size();
            int callees = f.getCalledFunctions(monitor).size();
            w.println(f.getEntryPoint() + "\t" + size + "\t" + f.getName() + "\t" + callers + "\t" + callees + "\t" + f.isThunk());
            n++;
        }
        w.close();
        println("DumpFunctions: wrote " + n + " functions to " + out);
    }
}
