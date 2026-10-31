// Decompile one function by address and write C to a file. Args: address, outpath
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.Function;
import java.io.*;
public class DecompileOne extends GhidraScript {
    @Override public void run() throws Exception {
        String[] a = getScriptArgs();
        Function f = getFunctionAt(toAddr(a[0]));
        DecompInterface d = new DecompInterface(); d.openProgram(currentProgram);
        DecompileResults r = d.decompileFunction(f, 120, monitor);
        PrintWriter w = new PrintWriter(new FileWriter(a[1]));
        w.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "FAILED: " + r.getErrorMessage());
        w.close(); d.dispose();
        println("DecompileOne: " + f.getName() + " ok=" + r.decompileCompleted());
    }
}
