setup() creates the checkpoint* tables
one checkpoint is saved per step (6 for a normal turn, more for retries);
each chkpt stores the whole state. This is why we reset attempts by input to 0 on input