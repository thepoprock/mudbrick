// Print instructions whose scalar operands equal any of the given values (decimal or 0x hex).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.util.*;
public class FindScalar extends GhidraScript {
    @Override public void run() throws Exception {
        Set<Long> want = new HashSet<>();
        for (String a : getScriptArgs()) want.add(Long.decode(a));
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            for (int i = 0; i < ins.getNumOperands(); i++)
                for (Object o : ins.getOpObjects(i))
                    if (o instanceof Scalar && want.contains(((Scalar) o).getUnsignedValue())) {
                        Function f = getFunctionContaining(ins.getAddress());
                        println("SCALAR " + ins.getAddress() + " " + ins + " in " + (f == null ? "?" : f.getName()));
                    }
        }
    }
}
