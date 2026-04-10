import {
  Add as AddIcon,
  Settings as SettingsIcon,
  Favorite as FavoriteIcon,
  Share as ShareIcon,
  CloudDownload as CloudDownloadIcon,
} from "@mui/icons-material"
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  Grid,
  Paper,
  TextField,
  Typography,
  Switch,
  FormControlLabel,
  Alert,
  Snackbar,
} from "@mui/material"
import { useState } from "react"

interface MaterialDemoPageProps {
  showToast: (message: string, type?: "success" | "error" | "info") => void
}

function MaterialCardDemo() {
  return (
    <Grid item xs={12} md={6}>
      <Card elevation={3}>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            Material Card
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This is a beautiful Material Design card with elevation and smooth
            shadows. Perfect for displaying content in an organized way.
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Chip label="Material" color="primary" sx={{ mr: 1 }} />
            <Chip label="Beautiful" color="secondary" />
          </Box>
        </CardContent>
        <CardActions>
          <Button size="small" startIcon={<FavoriteIcon />}>
            Like
          </Button>
          <Button size="small" startIcon={<ShareIcon />}>
            Share
          </Button>
        </CardActions>
      </Card>
    </Grid>
  )
}

function MaterialFormDemo({
  switchChecked,
  setSwitchChecked,
}: {
  switchChecked: boolean
  setSwitchChecked: (checked: boolean) => void
}) {
  return (
    <Grid item xs={12} md={6}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" gutterBottom>
          Material Form
        </Typography>
        <Box sx={{ mt: 2 }}>
          <TextField
            fullWidth
            label="Enter your name"
            variant="outlined"
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Your message"
            variant="outlined"
            multiline
            rows={3}
            sx={{ mb: 2 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={switchChecked}
                onChange={(e) => setSwitchChecked(e.target.checked)}
              />
            }
            label="Enable notifications"
          />
        </Box>
      </Paper>
    </Grid>
  )
}

function MaterialButtonsDemo({
  setDialogOpen,
  setSnackbarOpen,
  showToast,
}: {
  setDialogOpen: (open: boolean) => void
  setSnackbarOpen: (open: boolean) => void
  showToast: (message: string, type?: "success" | "error" | "info") => void
}) {
  return (
    <Grid item xs={12}>
      <Paper elevation={1} sx={{ p: 3 }}>
        <Typography variant="h5" component="h2" gutterBottom>
          Material Buttons
        </Typography>
        <Box
          sx={{
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <Button variant="contained" color="primary">
            Primary Button
          </Button>
          <Button variant="outlined" color="secondary">
            Secondary Button
          </Button>
          <Button variant="text" startIcon={<SettingsIcon />}>
            With Icon
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => setDialogOpen(true)}
          >
            Open Dialog
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<CloudDownloadIcon />}
            onClick={() => {
              setSnackbarOpen(true)
              showToast("Material UI component triggered!", "success")
            }}
          >
            Show Snackbar
          </Button>
        </Box>
      </Paper>
    </Grid>
  )
}

export function MaterialDemoPage({ showToast }: MaterialDemoPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [switchChecked, setSwitchChecked] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            Material Design Demo
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            Beautiful Material Design components powered by MUI
          </Typography>
        </Box>

        {/* Grid Layout */}
        <Grid container spacing={3}>
          <MaterialCardDemo />
          <MaterialFormDemo
            switchChecked={switchChecked}
            setSwitchChecked={setSwitchChecked}
          />
          <MaterialButtonsDemo
            setDialogOpen={setDialogOpen}
            setSnackbarOpen={setSnackbarOpen}
            showToast={showToast}
          />

          {/* Alert Examples */}
          <Grid item xs={12}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Alert severity="success">
                This is a success alert with Material Design!
              </Alert>
              <Alert severity="info">
                Material UI integrates beautifully with your existing theme.
              </Alert>
              <Alert severity="warning">
                You can use MUI components alongside your existing Radix UI
                components.
              </Alert>
            </Box>
          </Grid>
        </Grid>

        {/* Floating Action Button */}
        <Fab
          color="primary"
          aria-label="add"
          sx={{
            position: "fixed",
            bottom: 16,
            right: 16,
          }}
          onClick={() => showToast("FAB clicked!", "info")}
        >
          <AddIcon />
        </Fab>
      </Box>

      {/* Material Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Material Design Dialog</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            This is a beautiful Material Design dialog. It integrates seamlessly
            with your existing dark/light theme system!
          </Typography>
          <Box sx={{ mt: 2 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Dialog Input"
              type="text"
              fullWidth
              variant="outlined"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              setDialogOpen(false)
              showToast("Dialog action completed!", "success")
            }}
            variant="contained"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Material Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message="This is a Material UI Snackbar!"
      />
    </Container>
  )
}
